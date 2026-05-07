use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat, Stream};
use serde::Serialize;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tempfile::NamedTempFile;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingResult {
    pub wav_path: String,
    pub duration_ms: f64,
    pub sample_rate: u32,
    pub samples: usize,
}

enum RecorderCommand {
    Start,
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
    pub fn start(&mut self) -> Result<()> {
        self.command_tx.send(RecorderCommand::Start)?;
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

struct RecorderSession {
    started_at: Instant,
    sample_rate: u32,
    channels: u16,
    samples: Arc<Mutex<Vec<i16>>>,
    stream: Stream,
}

fn recorder_loop(command_rx: Receiver<RecorderCommand>, reply_tx: Sender<RecorderReply>) {
    let mut session: Option<RecorderSession> = None;
    while let Ok(command) = command_rx.recv() {
        let reply: Option<RecorderReply> = match command {
            RecorderCommand::Start => {
                if session.is_some() {
                    Some(Err("录音已在进行中".to_string()))
                } else {
                    match start_session() {
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
                session = None;
                None
            }
        };
        if let Some(reply) = reply {
            let _ = reply_tx.send(reply);
        }
    }
}

fn start_session() -> Result<RecorderSession> {
    let host = cpal::default_host();
    let device = host.default_input_device().context("找不到默认麦克风")?;
    let supported_config = device
        .default_input_config()
        .context("无法读取默认麦克风配置")?;
    let sample_rate = supported_config.sample_rate().0;
    let channels = supported_config.channels();
    let config = supported_config.config();
    let samples = Arc::new(Mutex::new(Vec::with_capacity(sample_rate as usize * 20)));
    let err_fn = |err| eprintln!("recording stream error: {err}");

    let stream = match supported_config.sample_format() {
        SampleFormat::F32 => build_stream::<f32>(&device, &config, Arc::clone(&samples), err_fn)?,
        SampleFormat::I16 => build_stream::<i16>(&device, &config, Arc::clone(&samples), err_fn)?,
        SampleFormat::U16 => build_stream::<u16>(&device, &config, Arc::clone(&samples), err_fn)?,
        format => return Err(anyhow!("不支持的麦克风采样格式：{format:?}")),
    };

    stream.play().context("无法启动麦克风录音")?;
    Ok(RecorderSession {
        started_at: Instant::now(),
        sample_rate,
        channels,
        samples,
        stream,
    })
}

fn stop_session(session: RecorderSession) -> Result<RecordingResult> {
    drop(session.stream);

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
    write_wav(&wav_path, session.sample_rate, session.channels, &samples)?;

    Ok(RecordingResult {
        wav_path: wav_path.to_string_lossy().to_string(),
        duration_ms,
        sample_rate: session.sample_rate,
        samples: samples.len(),
    })
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Arc<Mutex<Vec<i16>>>,
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
                if let Ok(mut target) = samples.lock() {
                    target.extend(data.iter().copied().map(i16::from_sample));
                }
            },
            err_fn,
            None,
        )
        .context("无法创建麦克风输入流")
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
