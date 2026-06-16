// Integration test for real Whisper transcription. Ignored by default because
// it needs the downloaded model and is slow/CPU-heavy. Run explicitly with:
//   cargo test --test stt_integration -- --ignored
//
// Requires the base.en model at /tmp/ggml-base.en.bin (downloaded in Task 5).

use openwispr_lib::stt::Transcriber;

#[test]
#[ignore]
fn transcribes_jfk_sample() {
    let model = "/tmp/ggml-base.en.bin";
    let wav_path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/jfk.wav");

    let mut reader = hound::WavReader::open(wav_path).expect("open wav");
    let spec = reader.spec();
    assert_eq!(spec.sample_rate, 16_000, "fixture must be 16kHz");
    let samples: Vec<f32> = reader
        .samples::<i16>()
        .map(|s| s.expect("sample") as f32 / 32768.0)
        .collect();

    let transcriber = Transcriber::load(model).expect("load model");
    let text = transcriber
        .transcribe(&samples, "en", "")
        .expect("transcribe");
    let lower = text.to_lowercase();
    assert!(
        lower.contains("country"),
        "expected 'country' in transcript, got: {text}"
    );
}
