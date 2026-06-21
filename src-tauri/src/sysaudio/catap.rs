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

use super::SystemAudioCapturer;
use crate::audio::rms_window;
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

/// Shared state written from the Core Audio IO thread and read by `level()` /
/// `stop()`. The IO block only ever locks `buffer`; sample_rate/channels are set
/// once in `start()` before the IO proc starts and read afterwards.
struct Shared {
    buffer: Mutex<Vec<f32>>,
    sample_rate: Mutex<u32>,
    channels: Mutex<u16>,
}

/// An active CATap capture. The handles are torn down in `stop()` (and, defensively,
/// in `Drop` if `stop()` is never called) in the reverse order of creation.
pub struct CatapCapturer {
    shared: Arc<Shared>,
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

// The raw Core Audio handles (`AudioObjectID` ints and the IO-proc/block pointers)
// are only ever touched on this object's own thread plus the Core Audio IO thread,
// which we coordinate through `Shared`'s mutexes. Sending the capturer between
// threads (it lives behind the `SystemAudioCapturer` trait object) is sound.
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

    // 5. Install the IO proc: copy each callback's interleaved f32 frames into the
    //    shared buffer. The aggregate delivers the tap's mix in the first buffer.
    let shared = Arc::new(Shared {
        buffer: Mutex::new(Vec::new()),
        sample_rate: Mutex::new(sample_rate.max(16_000)),
        channels: Mutex::new(channels.max(1)),
    });
    let shared_for_block = shared.clone();
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
            let Ok(mut out) = shared_for_block.buffer.lock() else {
                return;
            };
            // `mBuffers` is a flexible array member; iterate it as a slice.
            let buffers = std::slice::from_raw_parts(list.mBuffers.as_ptr(), n);
            for buf in buffers {
                if buf.mData.is_null() || buf.mDataByteSize == 0 {
                    continue;
                }
                let count = buf.mDataByteSize as usize / std::mem::size_of::<f32>();
                let samples = std::slice::from_raw_parts(buf.mData as *const f32, count);
                out.extend_from_slice(samples);
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
        let (sr, ch) = (
            *self.shared.sample_rate.lock().unwrap(),
            *self.shared.channels.lock().unwrap(),
        );
        // RMS over ~100 ms of interleaved samples, matching the mic meter.
        let window = (sr as usize) * (ch.max(1) as usize) / 10;
        self.shared
            .buffer
            .lock()
            .map(|b| rms_window(&b, window))
            .unwrap_or(0.0)
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
        let raw = self
            .shared
            .buffer
            .lock()
            .map(|b| b.clone())
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
