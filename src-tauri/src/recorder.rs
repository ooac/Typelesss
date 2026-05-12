use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat, Stream};
use serde::Serialize;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tempfile::NamedTempFile;
use tokio::sync::mpsc::UnboundedSender;

use crate::providers::RealtimeAsrCommand;

const ASR_SAMPLE_RATE: u32 = 16_000;
const REALTIME_CHUNK_MS: u32 = 40;
const ASR_LEADING_SILENCE_MS: u32 = 240;
const INPUT_WARM_UP_MS: u64 = 900;
const REALTIME_CHUNK_SAMPLES: usize =
    (ASR_SAMPLE_RATE as usize * REALTIME_CHUNK_MS as usize) / 1000;
const ASR_LEADING_SILENCE_SAMPLES: usize =
    (ASR_SAMPLE_RATE as usize * ASR_LEADING_SILENCE_MS as usize) / 1000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingResult {
    pub wav_path: String,
    pub duration_ms: f64,
    pub sample_rate: u32,
    pub samples: usize,
}

enum RecorderCommand {
    Start(Option<UnboundedSender<RealtimeAsrCommand>>),
    Stop,
    Cancel,
}

type RecorderReply = Result<Option<RecordingResult>, String>;

pub struct Recorder {
    command_tx: Sender<RecorderCommand>,
    reply_rx: Receiver<RecorderReply>,
}

impl Default for Recorder {
    fn default() -> Self {
        let (command_tx, command_rx) = mpsc::channel();
        let (reply_tx, reply_rx) = mpsc::channel();
        std::thread::spawn(move || recorder_loop(command_rx, reply_tx));
        Self {
            command_tx,
            reply_rx,
        }
    }
}

impl Recorder {
    pub fn start_with_realtime(
        &mut self,
        realtime_tx: Option<UnboundedSender<RealtimeAsrCommand>>,
    ) -> Result<()> {
        self.command_tx.send(RecorderCommand::Start(realtime_tx))?;
        match self.reply_rx.recv()? {
            Ok(None) => Ok(()),
            Ok(Some(_)) => Err(anyhow!("录音启动返回异常")),
            Err(err) => Err(anyhow!(err)),
        }
    }

    pub fn stop(&mut self) -> Result<RecordingResult> {
        self.command_tx.send(RecorderCommand::Stop)?;
        match self.reply_rx.recv()? {
            Ok(Some(result)) => Ok(result),
            Ok(None) => Err(anyhow!("录音状态异常")),
            Err(err) => Err(anyhow!(err)),
        }
    }

    pub fn cancel(&mut self) {
        let _ = self.command_tx.send(RecorderCommand::Cancel);
    }
}

pub fn warm_up_input_device() -> Result<()> {
    let host = cpal::default_host();
    let device = host.default_input_device().context("找不到默认麦克风")?;
    let supported_config = device
        .default_input_config()
        .context("无法读取默认麦克风配置")?;
    let config = supported_config.config();
    let err_fn = |err| eprintln!("microphone warm-up stream error: {err}");

    let stream = match supported_config.sample_format() {
        SampleFormat::F32 => build_warm_up_stream::<f32>(&device, &config, err_fn)?,
        SampleFormat::I16 => build_warm_up_stream::<i16>(&device, &config, err_fn)?,
        SampleFormat::U16 => build_warm_up_stream::<u16>(&device, &config, err_fn)?,
        format => return Err(anyhow!("不支持的麦克风采样格式：{format:?}")),
    };
    stream.play().context("无法启动麦克风预热流")?;
    std::thread::sleep(Duration::from_millis(INPUT_WARM_UP_MS));
    drop(stream);
    Ok(())
}

struct RecorderSession {
    started_at: Instant,
    sample_rate: u32,
    channels: u16,
    samples: Arc<Mutex<Vec<i16>>>,
    realtime_tx: Option<UnboundedSender<RealtimeAsrCommand>>,
    stream: Stream,
}

fn recorder_loop(command_rx: Receiver<RecorderCommand>, reply_tx: Sender<RecorderReply>) {
    let mut session: Option<RecorderSession> = None;
    while let Ok(command) = command_rx.recv() {
        let reply: Option<RecorderReply> = match command {
            RecorderCommand::Start(realtime_tx) => {
                if session.is_some() {
                    Some(Err("录音已在进行中".to_string()))
                } else {
                    match start_session(realtime_tx) {
                        Ok(next_session) => {
                            session = Some(next_session);
                            Some(Ok(None))
                        }
                        Err(err) => {
                            eprintln!("start recording failed: {err}");
                            Some(Err(err.to_string()))
                        }
                    }
                }
            }
            RecorderCommand::Stop => match session.take() {
                Some(active_session) => Some(
                    stop_session(active_session)
                        .map(Some)
                        .map_err(|err| err.to_string()),
                ),
                None => Some(Err("当前没有录音".to_string())),
            },
            RecorderCommand::Cancel => {
                if let Some(active_session) = session.take() {
                    if let Some(tx) = active_session.realtime_tx {
                        let _ = tx.send(RealtimeAsrCommand::Cancel);
                    }
                }
                None
            }
        };
        if let Some(reply) = reply {
            let _ = reply_tx.send(reply);
        }
    }
}

fn start_session(
    realtime_tx: Option<UnboundedSender<RealtimeAsrCommand>>,
) -> Result<RecorderSession> {
    let host = cpal::default_host();
    let device = host.default_input_device().context("找不到默认麦克风")?;
    let supported_config = device
        .default_input_config()
        .context("无法读取默认麦克风配置")?;
    let sample_rate = supported_config.sample_rate().0;
    let channels = supported_config.channels();
    let config = supported_config.config();
    let samples = Arc::new(Mutex::new(Vec::with_capacity(sample_rate as usize * 20)));
    let realtime_chunker = realtime_tx
        .clone()
        .map(|tx| Arc::new(Mutex::new(RealtimeChunker::new(sample_rate, channels, tx))));
    let err_fn = |err| eprintln!("recording stream error: {err}");

    let stream = match supported_config.sample_format() {
        SampleFormat::F32 => build_stream::<f32>(
            &device,
            &config,
            Arc::clone(&samples),
            realtime_chunker.clone(),
            err_fn,
        )?,
        SampleFormat::I16 => build_stream::<i16>(
            &device,
            &config,
            Arc::clone(&samples),
            realtime_chunker.clone(),
            err_fn,
        )?,
        SampleFormat::U16 => build_stream::<u16>(
            &device,
            &config,
            Arc::clone(&samples),
            realtime_chunker,
            err_fn,
        )?,
        format => return Err(anyhow!("不支持的麦克风采样格式：{format:?}")),
    };

    stream.play().context("无法启动麦克风录音")?;
    Ok(RecorderSession {
        started_at: Instant::now(),
        sample_rate,
        channels,
        samples,
        realtime_tx,
        stream,
    })
}

fn stop_session(session: RecorderSession) -> Result<RecordingResult> {
    drop(session.stream);
    if let Some(tx) = session.realtime_tx.as_ref() {
        let _ = tx.send(RealtimeAsrCommand::Commit);
    }

    let duration_ms = session.started_at.elapsed().as_secs_f64() * 1000.0;
    let samples = session
        .samples
        .lock()
        .map_err(|_| anyhow!("录音样本锁定失败"))?
        .clone();
    if samples.len() < session.sample_rate as usize / 8 {
        return Err(anyhow!("录音太短，请至少说半秒以上"));
    }

    let temp_file = NamedTempFile::new().context("无法创建临时录音文件")?;
    let (_file, path) = temp_file.keep().context("无法保留临时录音文件")?;
    let wav_path = path.with_extension("wav");
    let mono_samples = downmix_to_mono(&samples, session.channels);
    let asr_samples = resample_linear(&mono_samples, session.sample_rate, ASR_SAMPLE_RATE);
    let asr_samples = with_leading_silence(&asr_samples);
    write_wav(&wav_path, ASR_SAMPLE_RATE, 1, &asr_samples)?;

    Ok(RecordingResult {
        wav_path: wav_path.to_string_lossy().to_string(),
        duration_ms,
        sample_rate: ASR_SAMPLE_RATE,
        samples: asr_samples.len(),
    })
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Arc<Mutex<Vec<i16>>>,
    realtime_chunker: Option<Arc<Mutex<RealtimeChunker>>>,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<Stream>
where
    T: cpal::Sample + cpal::SizedSample,
    i16: cpal::FromSample<T>,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                let converted = data
                    .iter()
                    .copied()
                    .map(i16::from_sample)
                    .collect::<Vec<_>>();
                if let Ok(mut target) = samples.lock() {
                    target.extend_from_slice(&converted);
                }
                if let Some(chunker) = realtime_chunker.as_ref() {
                    if let Ok(mut chunker) = chunker.lock() {
                        chunker.push(&converted);
                    }
                }
            },
            err_fn,
            None,
        )
        .context("无法创建麦克风输入流")
}

fn build_warm_up_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<Stream>
where
    T: cpal::Sample + cpal::SizedSample,
{
    device
        .build_input_stream(config, move |_data: &[T], _| {}, err_fn, None)
        .context("无法创建麦克风预热流")
}

struct RealtimeChunker {
    source_rate: u32,
    channels: u16,
    pending: Vec<i16>,
    tx: UnboundedSender<RealtimeAsrCommand>,
}

impl RealtimeChunker {
    fn new(source_rate: u32, channels: u16, tx: UnboundedSender<RealtimeAsrCommand>) -> Self {
        Self {
            source_rate,
            channels,
            pending: vec![0; ASR_LEADING_SILENCE_SAMPLES],
            tx,
        }
    }

    fn push(&mut self, interleaved_samples: &[i16]) {
        if interleaved_samples.is_empty() {
            return;
        }

        let mono_samples = downmix_to_mono(interleaved_samples, self.channels);
        let asr_samples = resample_linear(&mono_samples, self.source_rate, ASR_SAMPLE_RATE);
        self.pending.extend(asr_samples);

        while self.pending.len() >= REALTIME_CHUNK_SAMPLES {
            let chunk = self
                .pending
                .drain(..REALTIME_CHUNK_SAMPLES)
                .collect::<Vec<_>>();
            if self.tx.send(RealtimeAsrCommand::Audio(chunk)).is_err() {
                self.pending.clear();
                break;
            }
        }
    }
}

fn with_leading_silence(samples: &[i16]) -> Vec<i16> {
    let mut padded = Vec::with_capacity(ASR_LEADING_SILENCE_SAMPLES + samples.len());
    padded.resize(ASR_LEADING_SILENCE_SAMPLES, 0);
    padded.extend_from_slice(samples);
    padded
}

fn write_wav(
    path: &std::path::Path,
    sample_rate: u32,
    channels: u16,
    samples: &[i16],
) -> Result<()> {
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .with_context(|| format!("无法创建 WAV 文件：{}", path.display()))?;
    for sample in samples {
        writer.write_sample(*sample)?;
    }
    writer.finalize()?;
    Ok(())
}

fn downmix_to_mono(samples: &[i16], channels: u16) -> Vec<i16> {
    let channels = channels.max(1) as usize;
    if channels == 1 {
        return samples.to_vec();
    }

    samples
        .chunks(channels)
        .map(|frame| {
            let sum: i32 = frame.iter().map(|sample| *sample as i32).sum();
            (sum / frame.len() as i32).clamp(i16::MIN as i32, i16::MAX as i32) as i16
        })
        .collect()
}

fn resample_linear(samples: &[i16], from_rate: u32, to_rate: u32) -> Vec<i16> {
    if samples.is_empty() || from_rate == 0 || to_rate == 0 {
        return Vec::new();
    }
    if from_rate == to_rate {
        return samples.to_vec();
    }

    let output_len = ((samples.len() as u64 * to_rate as u64) / from_rate as u64).max(1) as usize;
    let ratio = from_rate as f64 / to_rate as f64;
    (0..output_len)
        .map(|idx| {
            let source_pos = idx as f64 * ratio;
            let left = source_pos.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let fraction = source_pos - left as f64;
            let mixed = samples[left] as f64 * (1.0 - fraction) + samples[right] as f64 * fraction;
            mixed.round().clamp(i16::MIN as f64, i16::MAX as f64) as i16
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmixes_stereo_to_mono() {
        assert_eq!(downmix_to_mono(&[10, 30, -20, 10], 2), vec![20, -5]);
    }

    #[test]
    fn resamples_48k_to_16k() {
        let input = (0..48_000).map(|idx| idx as i16).collect::<Vec<_>>();
        let output = resample_linear(&input, 48_000, 16_000);
        assert_eq!(output.len(), 16_000);
        assert_eq!(output[0], 0);
        assert_eq!(output[1], 3);
    }

    #[test]
    fn prepends_asr_leading_silence() {
        let output = with_leading_silence(&[1, 2, 3]);
        assert_eq!(output.len(), ASR_LEADING_SILENCE_SAMPLES + 3);
        assert!(output[..ASR_LEADING_SILENCE_SAMPLES]
            .iter()
            .all(|sample| *sample == 0));
        assert_eq!(&output[ASR_LEADING_SILENCE_SAMPLES..], &[1, 2, 3]);
    }
}
