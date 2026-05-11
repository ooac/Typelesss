use serde::Serialize;

use crate::insertion;
use crate::modifier_hotkey;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionStatus {
    pub microphone: String, // granted | denied | unknown
    pub input_monitoring: String,
    pub accessibility: String,
}

pub fn check_all() -> PermissionStatus {
    PermissionStatus {
        // macOS authorizationStatusForMediaType requires Objective-C bridging.
        // Instead we surface "unknown" and provide an explicit "test microphone"
        // button that records 500ms and reports peak amplitude — if peaks are
        // present, the user knows the permission is effectively granted.
        microphone: "unknown".to_string(),
        input_monitoring: check_input_monitoring(),
        accessibility: check_accessibility(),
    }
}

fn check_input_monitoring() -> String {
    if modifier_hotkey::input_monitoring_permission_granted() {
        "granted".to_string()
    } else {
        "denied".to_string()
    }
}

fn check_accessibility() -> String {
    if insertion::has_accessibility_permission() {
        "granted".to_string()
    } else {
        "denied".to_string()
    }
}

/// Quick microphone test: opens default input device, captures ~500ms of samples,
/// and returns the peak amplitude in [0,1].  Used by the Permissions page to
/// verify that the OS actually delivers audio (zero peak ≈ no permission or
/// muted device; non-zero ≈ permission effectively granted).
pub fn test_microphone() -> Result<f32, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{Sample, SampleFormat};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "未找到默认音频输入设备。".to_string())?;
    let config = device
        .default_input_config()
        .map_err(|err| format!("无法读取默认音频配置：{err}"))?;

    let peak: Arc<Mutex<f32>> = Arc::new(Mutex::new(0.0));
    let err_state: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    let stream = {
        let peak_writer = Arc::clone(&peak);
        let err_writer = Arc::clone(&err_state);
        match config.sample_format() {
            SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| update_peak(data, &peak_writer, |s| s.abs()),
                move |err| *err_writer.lock().unwrap() = Some(err.to_string()),
                None,
            ),
            SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    update_peak(data, &peak_writer, |s| s.to_float_sample().abs())
                },
                move |err| *err_writer.lock().unwrap() = Some(err.to_string()),
                None,
            ),
            SampleFormat::U16 => device.build_input_stream(
                &config.into(),
                move |data: &[u16], _| {
                    update_peak(data, &peak_writer, |s| s.to_float_sample().abs())
                },
                move |err| *err_writer.lock().unwrap() = Some(err.to_string()),
                None,
            ),
            other => return Err(format!("不支持的采样格式：{other:?}")),
        }
    }
    .map_err(|err| format!("无法构建输入流：{err}"))?;

    stream
        .play()
        .map_err(|err| format!("无法启动输入流：{err}"))?;

    let started = Instant::now();
    while started.elapsed() < Duration::from_millis(500) {
        std::thread::sleep(Duration::from_millis(20));
    }

    drop(stream);

    if let Some(err) = err_state.lock().unwrap().take() {
        return Err(err);
    }

    let amplitude = *peak.lock().unwrap();
    Ok(amplitude)
}

fn update_peak<S, F>(data: &[S], peak: &std::sync::Arc<std::sync::Mutex<f32>>, abs_value: F)
where
    F: Fn(S) -> f32,
    S: Copy,
{
    let mut max_in_chunk: f32 = 0.0;
    for sample in data {
        let v = abs_value(*sample);
        if v > max_in_chunk {
            max_in_chunk = v;
        }
    }
    let mut current = peak.lock().unwrap();
    if max_in_chunk > *current {
        *current = max_in_chunk;
    }
}
