//! Core Audio process-tap capture (macOS 14.4+).
//!
//! Ported from insidegui/AudioCap (MIT, `AudioCap/ProcessTap/ProcessTap.swift`
//! + `CoreAudioUtils.swift`) and Apple's "Capturing system audio with Core Audio
//! taps" sample. This is the 14.4+ path: a Core Audio *process tap* over the
//! whole-system mix wired into a private *aggregate device*, whose IO proc copies
//! interleaved f32 PCM into a shared buffer (mirroring `audio::Recorder` and the
//! ScreenCaptureKit backend). The FFI is unsafe and OS-version-gated; it is
//! verified manually against a live meeting (Task 14), not by unit tests.
//!
//! Symbol provenance:
//! - From `coreaudio-sys` bindings: every aggregate-device / IO-proc function
//!   (`AudioHardwareCreate/DestroyAggregateDevice`,
//!   `AudioDeviceCreateIOProcIDWithBlock`, `AudioDeviceDestroyIOProcID`,
//!   `AudioDeviceStart`/`Stop`, `AudioObjectGetPropertyData`) and all the
//!   selector / dictionary-key constants.
//! - Hand-declared `extern "C"` below: `AudioHardwareCreateProcessTap` and
//!   `AudioHardwareDestroyProcessTap` — newer (macOS 14.4 SDK) symbols that are
//!   *not* in the `coreaudio-sys` 0.2.18 bindings. Both live in the CoreAudio
//!   framework that `coreaudio-sys` already links, so they resolve at link time.
//! - `CATapDescription` is an Objective-C class (also CoreAudio, 14.4+) with no
//!   binding; it is created via the objc2 runtime.
#![allow(non_upper_case_globals, non_snake_case)]

use super::{SysReader, SystemAudioCapturer};
use crate::audio::{resample_to_16k, rms_window, to_mono};
use std::cell::RefCell;
use std::sync::{Arc, Mutex};

use block2::RcBlock;
use core_foundation::array::CFArray;
use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use coreaudio_sys::{
    kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioTapPropertyFormat,
    AudioBufferList, AudioDeviceCreateIOProcIDWithBlock, AudioDeviceDestroyIOProcID,
    AudioDeviceIOProcID, AudioDeviceStart, AudioDeviceStop, AudioHardwareCreateAggregateDevice,
    AudioHardwareDestroyAggregateDevice, AudioObjectGetPropertyData, AudioObjectID,
    AudioObjectPropertyAddress, AudioStreamBasicDescription, OSStatus,
};
use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2_foundation::{NSArray, NSString};
use ringbuf::traits::{Consumer as _, Producer as _, Split};
use ringbuf::{HeapCons, HeapRb};

// Apple symbols missing from `coreaudio-sys` 0.2.18 (macOS 14.4 SDK). The first
// argument is a `CATapDescription *` (an Objective-C object pointer). Declared
// here against the CoreAudio framework `coreaudio-sys` already links.
extern "C" {
    /// `OSStatus AudioHardwareCreateProcessTap(CATapDescription *inDescription,
    ///  AudioObjectID *outTapID);`
    fn AudioHardwareCreateProcessTap(
        in_description: *mut AnyObject,
        out_tap_id: *mut AudioObjectID,
    ) -> OSStatus;

    /// `OSStatus AudioHardwareDestroyProcessTap(AudioObjectID inTapID);`
    fn AudioHardwareDestroyProcessTap(in_tap_id: AudioObjectID) -> OSStatus;
}

/// `kAudioObjectUnknown` — an invalid `AudioObjectID`, used as the "not created"
/// sentinel during teardown on error paths.
const AUDIO_OBJECT_UNKNOWN: AudioObjectID = 0;

/// Capacity of the SPSC ring that hands samples from the RT IO proc to the
/// consumer: ~4 s at 48 kHz stereo f32. Generous slack so a slow consumer drain
/// never overflows under normal scheduling; on overflow `push_slice` drops the
/// excess (acceptable for real-time audio).
const RING_CAPACITY: usize = 48_000 * 2 * 4;

/// Format state set once in `start()` (from the tap's ASBD) before the IO proc
/// starts, read afterwards by `level()`/`format()`/`stop()`. The real-time IO
/// proc never touches this — it only pushes into the lock-free ring.
struct Shared {
    sample_rate: Mutex<u32>,
    channels: Mutex<u16>,
}

/// Consumer-side state for the ring. Lives behind a `Mutex` on the capturer and
/// is **only ever touched off the real-time IO thread** (by `read_new`/`stop`/
/// `level`, all on the capturer's owning thread). `drain` pops everything the RT
/// proc has produced into `acc`, the full take; `read_pos` is the non-destructive
/// `read_new` cursor over `acc`.
struct Consumer {
    rx: HeapCons<f32>,
    acc: Vec<f32>,
    read_pos: usize,
}

/// An active CATap capture. The handles are torn down in `stop()` (and, defensively,
/// in `Drop` if `stop()` is never called) in the reverse order of creation.
pub struct CatapCapturer {
    shared: Arc<Shared>,
    /// Ring consumer + full-take accumulator + read cursor. The `Mutex` is now
    /// touched ONLY off the RT thread (the IO proc pushes into the lock-free
    /// producer, never this). Behind an `Arc` so a `SysReader` closure can share
    /// it with the live loop without moving the capturer.
    consumer: Arc<Mutex<Consumer>>,
    tap_id: AudioObjectID,
    aggregate_id: AudioObjectID,
    io_proc: AudioDeviceIOProcID,
    /// The IO block must outlive the IO proc that references it, so we keep it
    /// alive here for the whole capture. The block matches `AudioDeviceIOBlock`'s
    /// C ABI: five pointer args, returns void. We type the args as opaque
    /// `c_void` pointers (which `block2` can encode) and cast to the concrete
    /// Core Audio structs inside the body.
    _io_block: RcBlock<
        dyn Fn(
            *const std::ffi::c_void,
            *const std::ffi::c_void,
            *const std::ffi::c_void,
            *mut std::ffi::c_void,
            *const std::ffi::c_void,
        ),
    >,
}

/// Pop everything the RT IO proc has pushed into the ring into the full-take
/// accumulator. Called off the RT thread by `read_new`/`stop`/`level` so they all
/// see the latest audio. Keeps `acc` as the complete take (never consume-once).
fn drain(consumer: &Mutex<Consumer>) {
    let Ok(mut c) = consumer.lock() else {
        return;
    };
    let mut tmp = [0f32; 4096];
    loop {
        let n = c.rx.pop_slice(&mut tmp);
        if n == 0 {
            break;
        }
        c.acc.extend_from_slice(&tmp[..n]);
    }
}

// The raw Core Audio handles (`AudioObjectID` ints and the IO-proc/block pointers)
// are only ever touched on this object's own thread plus the Core Audio IO thread.
// The RT thread and the owning thread never share mutable state directly: the IO
// proc only pushes into the lock-free ring producer, and the consumer side
// (`Mutex<Consumer>`) is touched exclusively off the RT thread. Sending the
// capturer between threads (it lives behind the `SystemAudioCapturer` trait
// object) is sound.
unsafe impl Send for CatapCapturer {}

/// CoreFoundation dictionary key constants come out of `coreaudio-sys` as
/// NUL-terminated `&[u8]`; turn them into `CFString` keys.
fn cfkey(bytes: &[u8]) -> CFString {
    // Drop the trailing NUL the C string carries.
    let s = std::str::from_utf8(&bytes[..bytes.len().saturating_sub(1)]).unwrap_or("");
    CFString::new(s)
}

/// Read a device/object's UID string property (e.g. the default output device UID).
unsafe fn read_device_uid(object_id: AudioObjectID) -> Result<String, String> {
    let address = AudioObjectPropertyAddress {
        mSelector: coreaudio_sys::kAudioDevicePropertyDeviceUID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    };
    let mut cfstr: core_foundation::string::CFStringRef = std::ptr::null_mut();
    let mut size = std::mem::size_of::<core_foundation::string::CFStringRef>() as u32;
    let status = AudioObjectGetPropertyData(
        object_id,
        &address,
        0,
        std::ptr::null(),
        &mut size,
        &mut cfstr as *mut _ as *mut std::ffi::c_void,
    );
    if status != 0 || cfstr.is_null() {
        return Err(format!("read device UID failed (status {status})"));
    }
    // Take ownership of the +1 retain Core Audio handed back.
    let s = CFString::wrap_under_create_rule(cfstr);
    Ok(s.to_string())
}

/// Read the default system output device's `AudioObjectID`.
unsafe fn read_default_system_output_device() -> Result<AudioObjectID, String> {
    let address = AudioObjectPropertyAddress {
        mSelector: coreaudio_sys::kAudioHardwarePropertyDefaultSystemOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    };
    let mut device: AudioObjectID = AUDIO_OBJECT_UNKNOWN;
    let mut size = std::mem::size_of::<AudioObjectID>() as u32;
    let status = AudioObjectGetPropertyData(
        coreaudio_sys::kAudioObjectSystemObject as AudioObjectID,
        &address,
        0,
        std::ptr::null(),
        &mut size,
        &mut device as *mut _ as *mut std::ffi::c_void,
    );
    if status != 0 {
        return Err(format!(
            "read default output device failed (status {status})"
        ));
    }
    Ok(device)
}

/// Read the tap's stream format (`kAudioTapPropertyFormat`) → real sample rate +
/// channel count.
unsafe fn read_tap_format(tap_id: AudioObjectID) -> Result<AudioStreamBasicDescription, String> {
    let address = AudioObjectPropertyAddress {
        mSelector: kAudioTapPropertyFormat,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    };
    let mut asbd = AudioStreamBasicDescription::default();
    let mut size = std::mem::size_of::<AudioStreamBasicDescription>() as u32;
    let status = AudioObjectGetPropertyData(
        tap_id,
        &address,
        0,
        std::ptr::null(),
        &mut size,
        &mut asbd as *mut _ as *mut std::ffi::c_void,
    );
    if status != 0 {
        return Err(format!("read tap format failed (status {status})"));
    }
    Ok(asbd)
}

/// Tear down whatever has been created so far. Safe to call with sentinel /
/// null handles. Mirrors AudioCap's `invalidate()` order: stop, destroy IO proc,
/// destroy aggregate, destroy tap.
unsafe fn teardown(
    aggregate_id: AudioObjectID,
    io_proc: AudioDeviceIOProcID,
    tap_id: AudioObjectID,
) {
    if aggregate_id != AUDIO_OBJECT_UNKNOWN {
        if io_proc.is_some() {
            AudioDeviceStop(aggregate_id, io_proc);
            AudioDeviceDestroyIOProcID(aggregate_id, io_proc);
        }
        AudioHardwareDestroyAggregateDevice(aggregate_id);
    }
    if tap_id != AUDIO_OBJECT_UNKNOWN {
        AudioHardwareDestroyProcessTap(tap_id);
    }
}

pub fn start() -> Result<Box<dyn SystemAudioCapturer>, String> {
    unsafe { start_inner() }
}

unsafe fn start_inner() -> Result<Box<dyn SystemAudioCapturer>, String> {
    // 1. CATapDescription with an EMPTY process list → whole-system mix.
    //    `[[CATapDescription alloc] initStereoMixdownOfProcesses:@[]]`.
    let class = AnyClass::get(c"CATapDescription")
        .ok_or("CATapDescription unavailable (needs macOS 14.4+)")?;
    let empty: Retained<NSArray<AnyObject>> = NSArray::new();
    let alloc: *mut AnyObject = msg_send![class, alloc];
    let tap_desc: *mut AnyObject = msg_send![alloc, initStereoMixdownOfProcesses: &*empty];
    if tap_desc.is_null() {
        return Err("CATapDescription init failed".to_string());
    }
    // Retain-managed wrapper so the description is released on every return path.
    let tap_desc = Retained::from_raw(tap_desc).ok_or("CATapDescription init returned null")?;

    // The aggregate's tap list references the tap by the description's UUID string;
    // read it back from the object we just created (`tapDescription.uuid.uuidString`).
    let tap_uuid_string: String = {
        let uuid: *mut AnyObject = msg_send![&*tap_desc, UUID];
        if uuid.is_null() {
            return Err("CATapDescription UUID was nil".to_string());
        }
        let uuid_str: *mut NSString = msg_send![uuid, UUIDString];
        if uuid_str.is_null() {
            return Err("CATapDescription UUIDString was nil".to_string());
        }
        (*uuid_str).to_string()
    };

    // 2. Create the process tap.
    let mut tap_id: AudioObjectID = AUDIO_OBJECT_UNKNOWN;
    let status =
        AudioHardwareCreateProcessTap(Retained::as_ptr(&tap_desc) as *mut AnyObject, &mut tap_id);
    if status != 0 || tap_id == AUDIO_OBJECT_UNKNOWN {
        return Err(format!(
            "AudioHardwareCreateProcessTap failed (status {status})"
        ));
    }
    // From here on, any error must destroy the tap before returning.

    // 3. Read the tap's real format up front (used for sample_rate/channels and so
    //    a bad format fails before we build the aggregate).
    let asbd = match read_tap_format(tap_id) {
        Ok(a) => a,
        Err(e) => {
            teardown(AUDIO_OBJECT_UNKNOWN, None, tap_id);
            return Err(e);
        }
    };
    let sample_rate = asbd.mSampleRate as u32;
    let channels = asbd.mChannelsPerFrame as u16;

    // 4. Build the private aggregate device that includes the tap. We anchor it on
    //    the default system output device (like AudioCap) so the tap has a clock.
    let aggregate_id = match build_aggregate_device(&tap_uuid_string) {
        Ok(id) => id,
        Err(e) => {
            teardown(AUDIO_OBJECT_UNKNOWN, None, tap_id);
            return Err(e);
        }
    };

    // 5. Install the IO proc. The RT callback does ONLY a lock-free ring push:
    //    no Mutex, no allocation, no Vec realloc. A consumer off the RT thread
    //    drains the ring into the full-take accumulator (see `drain`).
    let shared = Arc::new(Shared {
        sample_rate: Mutex::new(sample_rate.max(16_000)),
        channels: Mutex::new(channels.max(1)),
    });

    // Lock-free SPSC ring: producer moves into the IO-proc block, consumer lives
    // behind the capturer's `Mutex<Consumer>`. `HeapProd<f32>` is `Send` (f32 is
    // `Send`), so moving it into the block (which crosses to the RT thread) is
    // sound. The block is `Fn`, but `push_slice` needs `&mut producer`, so the
    // producer is held in a `RefCell` and borrowed mutably for the push. The
    // borrow is uncontended: the IO proc is the single producer and runs only on
    // Core Audio's one RT thread.
    let rb = HeapRb::<f32>::new(RING_CAPACITY);
    let (producer, consumer_rx) = rb.split();
    let producer = RefCell::new(producer);
    let io_block = RcBlock::new(
        move |_in_now: *const std::ffi::c_void,
              in_input: *const std::ffi::c_void,
              _in_input_time: *const std::ffi::c_void,
              _out_output: *mut std::ffi::c_void,
              _in_output_time: *const std::ffi::c_void| {
            if in_input.is_null() {
                return;
            }
            // SAFETY: Core Audio guarantees `in_input` (the `inInputData` arg of
            // `AudioDeviceIOBlock`) points at a valid AudioBufferList for the
            // duration of the callback. The first (and, for a stereo mixdown,
            // only) buffer holds interleaved f32.
            let list = &*(in_input as *const AudioBufferList);
            let n = list.mNumberBuffers as usize;
            if n == 0 {
                return;
            }
            // Single producer, single thread: an uncontended mutable borrow.
            let mut prod = producer.borrow_mut();
            // `mBuffers` is a flexible array member; iterate it as a slice.
            let buffers = std::slice::from_raw_parts(list.mBuffers.as_ptr(), n);
            for buf in buffers {
                if buf.mData.is_null() || buf.mDataByteSize == 0 {
                    continue;
                }
                let count = buf.mDataByteSize as usize / std::mem::size_of::<f32>();
                let samples = std::slice::from_raw_parts(buf.mData as *const f32, count);
                // Lock-free push into the ring. On overflow `push_slice` writes
                // what fits and drops the rest (acceptable for real-time audio).
                prod.push_slice(samples);
            }
        },
    );

    let mut io_proc: AudioDeviceIOProcID = None;
    let status = AudioDeviceCreateIOProcIDWithBlock(
        &mut io_proc,
        aggregate_id,
        std::ptr::null_mut(), // null queue → Core Audio's real-time IO thread
        RcBlock::as_ptr(&io_block) as *mut std::ffi::c_void,
    );
    if status != 0 || io_proc.is_none() {
        teardown(aggregate_id, None, tap_id);
        return Err(format!(
            "AudioDeviceCreateIOProcIDWithBlock failed (status {status})"
        ));
    }

    // 6. Start the device.
    let status = AudioDeviceStart(aggregate_id, io_proc);
    if status != 0 {
        teardown(aggregate_id, io_proc, tap_id);
        return Err(format!("AudioDeviceStart failed (status {status})"));
    }

    Ok(Box::new(CatapCapturer {
        shared,
        consumer: Arc::new(Mutex::new(Consumer {
            rx: consumer_rx,
            acc: Vec::new(),
            read_pos: 0,
        })),
        tap_id,
        aggregate_id,
        io_proc,
        _io_block: io_block,
    }))
}

/// Build the private aggregate-device CFDictionary (per AudioCap) and create it.
/// The dictionary anchors the tap on the default system output device and lists
/// the tap by its description UUID string.
unsafe fn build_aggregate_device(tap_uuid_string: &str) -> Result<AudioObjectID, String> {
    use coreaudio_sys::{
        kAudioAggregateDeviceIsPrivateKey, kAudioAggregateDeviceIsStackedKey,
        kAudioAggregateDeviceMainSubDeviceKey, kAudioAggregateDeviceNameKey,
        kAudioAggregateDeviceSubDeviceListKey, kAudioAggregateDeviceTapAutoStartKey,
        kAudioAggregateDeviceTapListKey, kAudioAggregateDeviceUIDKey, kAudioSubDeviceUIDKey,
        kAudioSubTapDriftCompensationKey, kAudioSubTapUIDKey,
    };

    let output_id = read_default_system_output_device()?;
    let output_uid = read_device_uid(output_id)?;

    // Random-ish unique UID for the private aggregate; uniqueness matters only
    // within this process's lifetime.
    let aggregate_uid = format!(
        "wisper-catap-{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );

    // Sub-device entry: [{ uid: outputUID }]
    let sub_device: CFDictionary<CFString, CFType> = CFDictionary::from_CFType_pairs(&[(
        cfkey(kAudioSubDeviceUIDKey),
        CFString::new(&output_uid).as_CFType(),
    )]);
    let sub_device_list = CFArray::from_CFTypes(&[sub_device]);

    // Tap entry: [{ drift: true, uid: tapUUIDString }]
    let tap_entry: CFDictionary<CFString, CFType> = CFDictionary::from_CFType_pairs(&[
        (
            cfkey(kAudioSubTapDriftCompensationKey),
            CFBoolean::true_value().as_CFType(),
        ),
        (
            cfkey(kAudioSubTapUIDKey),
            CFString::new(tap_uuid_string).as_CFType(),
        ),
    ]);
    let tap_list = CFArray::from_CFTypes(&[tap_entry]);

    let description: CFDictionary<CFString, CFType> = CFDictionary::from_CFType_pairs(&[
        (
            cfkey(kAudioAggregateDeviceNameKey),
            CFString::new("Wisper System Capture").as_CFType(),
        ),
        (
            cfkey(kAudioAggregateDeviceUIDKey),
            CFString::new(&aggregate_uid).as_CFType(),
        ),
        (
            cfkey(kAudioAggregateDeviceMainSubDeviceKey),
            CFString::new(&output_uid).as_CFType(),
        ),
        (
            cfkey(kAudioAggregateDeviceIsPrivateKey),
            CFBoolean::true_value().as_CFType(),
        ),
        (
            cfkey(kAudioAggregateDeviceIsStackedKey),
            CFBoolean::false_value().as_CFType(),
        ),
        (
            cfkey(kAudioAggregateDeviceTapAutoStartKey),
            CFBoolean::true_value().as_CFType(),
        ),
        (
            cfkey(kAudioAggregateDeviceSubDeviceListKey),
            sub_device_list.as_CFType(),
        ),
        (cfkey(kAudioAggregateDeviceTapListKey), tap_list.as_CFType()),
    ]);

    let mut aggregate_id: AudioObjectID = AUDIO_OBJECT_UNKNOWN;
    let status = AudioHardwareCreateAggregateDevice(
        description.as_concrete_TypeRef() as _,
        &mut aggregate_id,
    );
    if status != 0 || aggregate_id == AUDIO_OBJECT_UNKNOWN {
        return Err(format!(
            "AudioHardwareCreateAggregateDevice failed (status {status})"
        ));
    }
    Ok(aggregate_id)
}

impl SystemAudioCapturer for CatapCapturer {
    fn level(&self) -> f32 {
        // Drain the ring first so RMS reflects the latest audio.
        drain(&self.consumer);
        let (sr, ch) = (
            *self.shared.sample_rate.lock().unwrap(),
            *self.shared.channels.lock().unwrap(),
        );
        // RMS over ~100 ms of interleaved samples, matching the mic meter.
        let window = (sr as usize) * (ch.max(1) as usize) / 10;
        self.consumer
            .lock()
            .map(|c| rms_window(&c.acc, window))
            .unwrap_or(0.0)
    }

    fn reader(&self) -> SysReader {
        let consumer = self.consumer.clone();
        let shared = self.shared.clone();
        SysReader(Box::new(move || {
            // Drain the lock-free ring into the accumulator first, then read
            // forward from the cursor — same path the old `read_new` took.
            drain(&consumer);
            let raw = {
                let Ok(mut c) = consumer.lock() else {
                    return Vec::new();
                };
                let (new, advanced) = crate::audio::read_new_from(&c.acc, c.read_pos);
                c.read_pos = advanced;
                new
            };
            let (sr, ch) = (
                *shared.sample_rate.lock().unwrap(),
                *shared.channels.lock().unwrap(),
            );
            let mono = to_mono(&raw, ch);
            resample_to_16k(&mono, sr)
        }))
    }

    fn stop(mut self: Box<Self>) -> (Vec<f32>, u32, u16) {
        // SAFETY: tear down in reverse order of creation; handles are valid here
        // because they were checked non-null in `start()`. Then clear the fields
        // so the `Drop` impl that runs when this box falls out of scope sees the
        // consumed sentinels and does nothing (no double free).
        unsafe {
            teardown(self.aggregate_id, self.io_proc, self.tap_id);
        }
        self.aggregate_id = AUDIO_OBJECT_UNKNOWN;
        self.io_proc = None;
        self.tap_id = AUDIO_OBJECT_UNKNOWN;
        // The IO proc is stopped/destroyed above, so the RT thread is quiesced and
        // no longer pushing; drain whatever it produced into the full take, then
        // hand back the complete accumulator.
        drain(&self.consumer);
        let raw = self
            .consumer
            .lock()
            .map(|c| c.acc.clone())
            .unwrap_or_default();
        let sr = *self.shared.sample_rate.lock().unwrap();
        let ch = *self.shared.channels.lock().unwrap();
        // `_io_block` drops with the box, releasing the block after the IO proc
        // is destroyed.
        (raw, sr.max(16_000), ch.max(1))
    }
}

impl Drop for CatapCapturer {
    fn drop(&mut self) {
        // Defensive: if the capturer is dropped without `stop()` (it normally
        // isn't — `stop()` consumes the box), still release the Core Audio
        // handles so we never leak a tap/aggregate device.
        unsafe {
            teardown(self.aggregate_id, self.io_proc, self.tap_id);
        }
        // Mark handles consumed so a later `stop()` path can't double-free.
        self.aggregate_id = AUDIO_OBJECT_UNKNOWN;
        self.io_proc = None;
        self.tap_id = AUDIO_OBJECT_UNKNOWN;
    }
}
