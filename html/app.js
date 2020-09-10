import * as lib from './lib.js';
import {LOG_VERYSPAM, LOG_SPAM, LOG_DEBUG, LOG_INFO, LOG_WARNING, LOG_ERROR} from './lib.js';
import {LOG_LEVELS} from './lib.js';

// Work around some issues related to caching and error reporting
//   by forcing this to load up top, before we try to 'addModule' it.
import './audio-worklet.js';

const session_id = Math.floor(Math.random() * 2**32).toString(16);
lib.set_logging_session_id(session_id);
lib.set_logging_context_id("main");

var log_level_select = document.getElementById('logLevel');

LOG_LEVELS.forEach((level) => {
  var el = document.createElement("option");
  el.value = level[0];
  el.text = level[1];
  if (lib.log_level == level[0]) {
    el.selected = true;
  }
  log_level_select.appendChild(el);
});

// We fall back exponentially until we find a good size, but we need a
// place to start that should be reasonably fair.
const INITIAL_MS_PER_BATCH = 180;  // XXX: probably make sure this is a multiple of our opus frame size (60ms)
// If we have fallen back so much that we are now taking this long,
// then give up and let the user know things are broken.
const MAX_MS_PER_BATCH = 900;

// this must be 2.5, 5, 10, 20, 40, or 60.
const OPUS_FRAME_MS = 60;

lib.log(LOG_INFO, "Starting up");

const userid = Math.round(Math.random()*100000000000)

function set_error(msg) {
  window.errorBox.innerText = msg;
  window.errorBox.style.display = msg ? "block" : "none";
}

function clear_error() {
  set_error("");
}

function close_stream(stream) {
  stream.getTracks().forEach((track) => track.stop());
}

async function force_permission_prompt() {
  // In order to enumerate devices, we must first force a permission prompt by opening a device and then closing it again.
  // See: https://stackoverflow.com/questions/60297972/navigator-mediadevices-enumeratedevices-returns-empty-labels
  var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  close_stream(stream);
}

async function wait_for_mic_permissions() {
  try {
    var perm_status = await navigator.permissions.query({name: "microphone"});
    if (perm_status.state == "granted" || perm_status.state == "denied") {
      return;
    }
  } catch {
    await force_permission_prompt();
    return;
  }

  force_permission_prompt();
  return new Promise((resolve, reject) => {
    perm_status.onchange = (e) => {
      if (e.target.state == "granted" || e.target.state == "denied") {
        resolve();
      }
    }
  });
}

function receiveChatMessage(username, message) {
  const msg = document.createElement("div");
  const name_element = document.createElement("span");
  name_element.className = "chatName";
  name_element.innerText = username;
  const msg_body_element = document.createElement("span");
  msg_body_element.innerText = ": " + message;
  msg.appendChild(name_element);
  msg.appendChild(msg_body_element);
  window.chatDisplay.appendChild(msg);
  window.chatDisplay.scrollTop = window.chatDisplay.scrollHeight;
}

let chatsToSend = [];
function sendChatMessage() {
  if (!window.chatEntry.value) return;
  receiveChatMessage(window.userName.value, window.chatEntry.value);
  chatsToSend.push(window.chatEntry.value);
  window.chatEntry.value = "";
}

window.chatEntry.addEventListener("change", sendChatMessage);
window.chatPost.addEventListener("click", sendChatMessage);

let requestedLeadPosition = false;
function takeLeadPosition() {
  requestedLeadPosition = true;
}

window.takeLead.addEventListener("click", takeLeadPosition);

function persist(textFieldId) {
  const textField = document.getElementById(textFieldId);
  const prevVal = localStorage.getItem(textFieldId);
  if (prevVal !== null) {
    textField.value = prevVal;
  }

  textField.addEventListener("change", () => {
    localStorage.setItem(textFieldId, textField.value);
  });
}

persist("userName");
persist("audioOffset");

function setMainAppVisibility() {
  if (window.userName.value) {
    window.mainApp.style.display = "block";
  }
}

setMainAppVisibility();
window.userName.addEventListener("change", setMainAppVisibility);

var in_select = document.getElementById('inSelect');
var out_select = document.getElementById('outSelect');
var click_bpm = document.getElementById('clickBPM');

in_select.addEventListener("change", reset_if_running);
out_select.addEventListener("change", reset_if_running);

async function enumerate_devices() {
  navigator.mediaDevices.enumerateDevices().then((devices) => {
    // Clear existing entries
    in_select.options.length = 0;
    out_select.options.length = 0;

    devices.forEach((info) => {
      var el = document.createElement("option");
      el.value = info.deviceId;
      if (info.kind === 'audioinput') {
        el.text = info.label || 'Unknown Input';
        in_select.appendChild(el);
      } else if (info.kind === 'audiooutput') {
        el.text = info.label || 'Unknown Output';
        out_select.appendChild(el);
      }
    });

    var el = document.createElement("option");
    el.text = "---";
    el.disabled = true;
    in_select.appendChild(el);

    el = document.createElement("option");
    el.value = "SILENCE";
    el.text = "SILENCE";
    in_select.appendChild(el);

    /* Disabled for more public test, since it wastes a lot
       of bandwidth re-downloading a giant MP3
    el = document.createElement("option");
    el.value = "HAMILTON";
    el.text = "HAMILTON";
    in_select.appendChild(el);
    */

    el = document.createElement("option");
    el.value = "CLICKS";
    el.text = "CLICKS";
    in_select.appendChild(el);

    el = document.createElement("option");
    el.value = "ECHO";
    el.text = "ECHO";
    in_select.appendChild(el);

    el = document.createElement("option");
    el.value = "NUMERIC";
    el.text = "NUMERIC";
    in_select.appendChild(el);

    el = document.createElement("option");
    el.text = "---";
    el.disabled = true;
    out_select.appendChild(el);

    el = document.createElement("option");
    el.value = "NOWHERE";
    el.text = "NOWHERE";
    out_select.appendChild(el);

    el = document.createElement("option");
    el.value = "NUMERIC";
    el.text = "NUMERIC (use with NUMERIC source)";
    out_select.appendChild(el);
  });
}

var audioCtx;

var start_button = document.getElementById('startButton');
var mute_button = document.getElementById('muteButton');
var click_volume_slider = document.getElementById('clickVolumeSlider');
var loopback_mode_select = document.getElementById('loopbackMode');
var server_path_text = document.getElementById('serverPath');
var audio_offset_text = document.getElementById('audioOffset');
var web_audio_output_latency_text = document.getElementById('webAudioOutputLatency');
var latency_compensation_label = document.getElementById('latencyCompensationLabel');
var latency_compensation_apply_button = document.getElementById('latencyCompensationApply');
var sample_rate_text = document.getElementById('sampleRate');
var peak_in_text = document.getElementById('peakIn');
var peak_out_text = document.getElementById('peakOut');
var hamilton_audio_span = document.getElementById('hamiltonAudioSpan');
var output_audio_span = document.getElementById('outputAudioSpan');
var client_total_time = document.getElementById('clientTotalTime');
var client_read_slippage = document.getElementById('clientReadSlippage');
var running = false;

function set_controls() {
  start_button.textContent = running ? "Stop" : "Start";

  mute_button.disabled = !running;
  loopback_mode_select.disabled = !running;
  click_bpm.disabled = running;

  in_select.disabled = false;
  out_select.disabled = false;
}

async function initialize() {
  await wait_for_mic_permissions();
  await enumerate_devices();
  set_controls(running);

  if (document.location.hostname == "localhost" ||
      document.location.hostname == "www.jefftk.com") {
    // Better default
    server_path_text.value = "http://localhost:8081/"
  }

  var hash = window.location.hash;
  if (hash && hash.length > 1) {
    var audio_offset = parseInt(hash.substr(1), 10);
    if (audio_offset >= 0 && audio_offset <= 60) {
      audio_offset_text.value = audio_offset;
    }
  }
}

function debug_check_sample_rate(rate) {
  if (isNaN(parseInt(sample_rate_text.value)) /* warning text */) {
    lib.log(LOG_DEBUG, "First setting sample rate:", rate);
    sample_rate_text.value = rate;
  } else if (sample_rate_text.value == rate.toString()) {
    lib.log(LOG_DEBUG, "Sample rate is still", rate);
  } else {
    lib.log(LOG_ERROR, "SAMPLE RATE CHANGED from", sample_rate_text.value, "to", rate);
    sample_rate_text.value = "ERROR: SAMPLE RATE CHANGED from " + sample_rate_text.value + " to " + rate + "!!";
    stop();
  }
}

async function configure_input_node(audioCtx) {
  synthetic_audio_source = null;
  var deviceId = in_select.value;
  if (deviceId == "NUMERIC" ||
      deviceId == "CLICKS" ||
      deviceId == "ECHO") {
    synthetic_audio_source = deviceId;
    synthetic_click_interval = 60.0 / parseFloat(click_bpm.value);
    // Signal the audioworklet for special handling, then treat as "SILENCE" for other purposes.
    deviceId = "SILENCE";
  }

  if (deviceId == "SILENCE") {
    var buffer = audioCtx.createBuffer(1, 128, audioCtx.sampleRate);
    var source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopEnd = source.buffer.duration;
    source.start();
    return source;
  } else if (deviceId == "HAMILTON") {
    override_gain = 0.5;
    var hamilton_audio = hamilton_audio_span.getElementsByTagName('audio')[0];
    // Can't use createMediaElementSource because you can only
    //   ever do that once per element, so we could never restart.
    //   See: https://github.com/webAudio/web-audio-api/issues/1202
    var source = audioCtx.createMediaStreamSource(hamilton_audio.captureStream());
    // NOTE: You MUST NOT call "load" on the element after calling
    //   captureStream, or the capture will break. This is not documented
    //   anywhere, of course.
    hamilton_audio.muted = true;  // Output via stream only
    hamilton_audio.loop = true;
    hamilton_audio.controls = false;
    lib.log(LOG_DEBUG, "Starting playback of hamilton...");
    await hamilton_audio.play();
    lib.log(LOG_DEBUG, "... started");
    return source;
  }

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      deviceId: { exact: deviceId }
    }
  });

  return new MediaStreamAudioSourceNode(audioCtx, { mediaStream: micStream });
}

function configure_output_node(audioCtx) {
  synthetic_audio_sink = false;
  var deviceId = out_select.value;
  var dest = audioCtx.createMediaStreamDestination();

  if (deviceId == "NUMERIC") {
    // Leave the device empty, but signal the worklet for special handling
    synthetic_audio_sink = true;
  } else if (deviceId == "NOWHERE") {
    // Leave the device empty
  } else {
    var audio_out = new Audio();
    audio_out.srcObject = dest.stream;
    // Android Chromedoes not have setSinkId:
    // https://bugs.chromium.org/p/chromium/issues/detail?id=648286
    if (audio_out.setSinkId) {
      audio_out.setSinkId(deviceId);
    }
    audio_out.play();
  }

  return dest;
}

// NOTE NOTE NOTE:
// * All `clock` variables are measured in samples.
// * All `clock` variables represent the END of an interval, NOT the
//   beginning. It's arbitrary which one to use, but you have to be
//   consistent, and trust me that it's slightly nicer this way.
var server_clock;
var playerNode;
var micStream;
var read_clock;
var mic_buf;
var mic_buf_clock;
var loopback_mode;
var server_path;
var audio_offset;
var xhrs_inflight;
var override_gain = 1.0;
var synthetic_audio_source;
var synthetic_audio_sink;
var synthetic_click_interval;
var sample_rate = 11025;  // Firefox may get upset if we use a weird value here? Also, we may not want to force this to a specific value?
var encoder;
var decoder;

function ms_to_batches(ms) {
  return Math.round(sample_rate / 128 / 1000 * ms);
}

function batches_to_ms(batches) {
  return Math.round(batches * 128 * 1000 / sample_rate);
}

// How many samples should we accumulate before sending to the server?
// In units of 128 samples.
var sample_batch_size = null;  // set by start()
var max_sample_batch_size = ms_to_batches(MAX_MS_PER_BATCH);

async function query_server_clock() {
  if (loopback_mode == "main") {
    // I got yer server right here!
    server_clock = Math.round(Date.now() * sample_rate / 1000.0);
  } else {
    // Support relative paths
    var target_url = new URL(server_path, document.location);
    var request_time_ms = Date.now();
    var fetch_result = await fetch(target_url, {
      method: "get",  // default
      cache: "no-store",
    });
    // We need one-way latency; dividing by 2 is unprincipled but probably close enough.
    // XXX: This is not actually correct. We should really be using the roundtrip latency here. Because we want to know not "what is the server clock now", but "what will the server clock be by the time my request reaches the server."
    // Proposed alternative:
    /*
      var request_time_samples = Math.round(request_time_ms * sample_rate / 1000.0);
      var metadata = JSON.parse(fetch_result.headers.get("X-Audio-Metadata"));
      // Add this to "our time now" to yield "server time when it gets our request."
      server_sample_offset = metadata["server_clock"] - request_time_samples;
      // Note: In the presence of network jitter, our message can get to the server either before or after the target server moment. This means that if our target server moment is "now", our actual requested moment could end up in the future. Someone on one side or the other has to deal with this. But in general if we are requesting "now" it means we do not expect to get audio data at all, so it should be okay for us to never ask for audio data in the case (and it should be ok for the server to give us zeros for "future" data, since we should never have asked, but that's what _would_ be there.)
    */
    var server_latency_ms = (Date.now() - request_time_ms) / 2.0;  // Wrong, see above
    var metadata = JSON.parse(fetch_result.headers.get("X-Audio-Metadata"));
    server_clock = Math.round(metadata["server_clock"] + server_latency_ms * sample_rate / 1000.0);
    lib.log(LOG_INFO, "Server clock is estimated to be:", server_clock, " (", metadata["server_clock"], "+", server_latency_ms * sample_rate / 1000.0);
  }
}

function set_estimate_latency_mode(mode) {
  playerNode.port.postMessage({
    "type": "latency_estimation_mode",
    "enabled": mode
  });
}

function click_volume_change() {
  playerNode.port.postMessage({
    "type": "click_volume_change",
    "value": click_volume_slider.value
  });
}

var muted = false;
function toggle_mute() {
  muted = !muted;
  mute_button.innerText = muted ? "Unmute" : "Mute";
  playerNode.port.postMessage({
    "type": "mute_mode",
    "enabled": muted
  });
}

async function reset_if_running() {
  if (running) {
    await start_stop();
    await start_stop();
  }
}

async function audio_offset_change() {
  if (running) {
    await reload_settings();
  }
}

async function start_stop() {
  const was_running = running;
  running = !was_running;
  set_controls();
  was_running ? stop() : start();
}

async function send_and_wait(port, msg, transfer) {
    return new Promise(function (resolve, _) {
        // XXX: I don't really trust this dynamic setting of onmessage business, but the example code does it so I'm leaving it for now... :-\
        port.onmessage = function (ev) {
            resolve(ev);
        }
        port.postMessage(msg, transfer);
    });
}

var expected_bogus_header = [
    79, 112, 117, 115, 72, 101, 97, 100, // "OpusHead"
    1, // version
    1, // channels
    0, 0, // pre-skip frames
    128, 187, 0, 0, // sample rate (48,000)
    0, 0, // output gain
    0 // channel mapping mode
];

class AudioEncoder {
    constructor(path) {
        this.worker = new Worker(path);

        this.encode = this.worker_rpc;
    }

    async worker_rpc(msg) {
        var ev = await send_and_wait(this.worker, msg);
        if (ev.data.status != 0) {
            throw ev.data;
        }
        return ev.data.packets;
    };

    async setup(cfg) {
        var packets = await this.worker_rpc(cfg);
        // This opus wrapper library adds a bogus header, which we validate and then strip for our sanity.
        if (packets.length != 1 || packets[0].data.byteLength != expected_bogus_header.length) {
            throw { err: "Bad header packet", data: packets };
        }
        var bogus_header = new Uint8Array(packets[0].data);
        for (var i = 0; i < expected_bogus_header.length; i++) {
            if (bogus_header[i] != expected_bogus_header[i]) {
                throw { err: "Bad header packet", data: packets };
            }
        }
        // return nothing.
    }
}

class AudioDecoder {
    constructor(path) {
        this.worker = new Worker(path);
    }

    async worker_rpc(msg, transfer) {
        var ev = await send_and_wait(this.worker, msg, transfer);
        if (ev.data.status != 0) {
            throw ev.data;
        }
        return ev.data;
    };

    async setup() {
        var bogus_header_packet = {
            data: Uint8Array.from(expected_bogus_header).buffer
        };
        return await this.worker_rpc({
            config: {},  // not used
            packets: [bogus_header_packet],
        });
    }

    async decode(packet) {
        return await this.worker_rpc(packet, [packet.data]);
    }
}

async function start() {
  clear_error();

  sample_batch_size = ms_to_batches(INITIAL_MS_PER_BATCH);
  window.msBatchSize.value = batches_to_ms(sample_batch_size);

  var AudioContext = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContext({ sampleRate: sample_rate });
  lib.log(LOG_DEBUG, "Audio Context:", audioCtx);
  debug_check_sample_rate(audioCtx.sampleRate);

  var micNode = await configure_input_node(audioCtx);
  var spkrNode = configure_output_node(audioCtx);

  await audioCtx.audioWorklet.addModule('audio-worklet.js');
  playerNode = new AudioWorkletNode(audioCtx, 'player');
  // Stop if there is an exception inside the worklet.
  playerNode.addEventListener("processorerror", stop);
  playerNode.port.postMessage({
    type: "log_params",
    session_id: session_id,
    log_level: lib.log_level
  });

  encoder = new AudioEncoder('opusjs/encoder.js');
  decoder = new AudioDecoder('opusjs/decoder.js')

  var enc_cfg = {
      sampling_rate: audioCtx.sampleRate,
      num_of_channels: 1,
      params: {
          application: 2049,  // AUDIO
          sampling_rate: 48000,
          frame_duration: OPUS_FRAME_MS,
      }
  };
  lib.log(LOG_DEBUG, "Setting up opus encoder and decoder. Encoder params:", enc_cfg);
  await encoder.setup(enc_cfg);
  var info = await decoder.setup();
  lib.log(LOG_DEBUG, "Opus decoder returned parameters:", info);
  // The encoder stuff absolutely has to finish getting initialized before we start getting messages for it, or shit will get regrettably real. (It is designed in a non-threadsafe way, which is remarkable since javascript has no threads.)

  playerNode.port.onmessage = handle_message;
  micNode.connect(playerNode);

  // This may not work in Firefox.
  playerNode.connect(spkrNode);

  // To use the default output device, which should be supported on all browsers, instead use:
  // playerNode.connect(audioCtx.destination);

  await reload_settings();

  window.calibration.style.display = "block";

  set_estimate_latency_mode(true);
}

async function reload_settings() {
  audio_offset = parseInt(audio_offset_text.value) * sample_rate;

  read_clock = null;
  mic_buf = [];
  mic_buf_clock = null;
  xhrs_inflight = 0;
  override_gain = 1.0;

  loopback_mode = loopback_mode_select.value;
  server_path = server_path_text.value;

  await query_server_clock();
  read_clock = server_clock - audio_offset;

  // Send this before we set audio params, which declares us to be ready for audio
  click_volume_change();
  var audio_params = {
    type: "audio_params",
    synthetic_source: synthetic_audio_source,
    click_interval: synthetic_click_interval,
    synthetic_sink: synthetic_audio_sink,
    loopback_mode: loopback_mode
  }
  playerNode.port.postMessage(audio_params);
}

function send_local_latency() {
  var local_latency_ms = parseFloat(estLatency.innerText);

  // Convert from ms to samples.
  var local_latency = Math.round(local_latency_ms * sample_rate / 1000);

  if (synthetic_audio_source !== null) {
    local_latency = 0;
  }
  playerNode.port.postMessage({
    "type": "local_latency",
    "local_latency": local_latency,
  });
}

function samples_to_worklet(samples, clock) {
  var message = {
    type: "samples_in",
    samples: samples,
    clock: clock
  };

  lib.log(LOG_SPAM, "Posting to worklet:", message);
  playerNode.port.postMessage(message);
}

// XXX
var sample_encoding = {
  client: Int8Array,
  server: "b",
  // Translate from/to Float32
  send: (x) => {
    x = x * override_gain * 128;
    x = Math.max(Math.min(x, 127), -128);
    return x;
  },
  recv: (x) => x / 127.0
};

function handle_message(event) {
  var msg = event.data;
  lib.log(LOG_VERYSPAM, "onmessage in main thread received ", msg);

  if (!running) {
    lib.log(LOG_WARNING, "Got message when done running");
    return;
  }

  if (msg.type == "exception") {
    lib.log(LOG_ERROR, "Exception thrown in audioworklet:", msg.exception);
    reload_settings();
    return;
  } else if (msg.type == "no_mic_input") {
    window.noAudioInputInstructions.style.display = "block";
    return;
  } else if (msg.type == "latency_estimate") {
    window.estSamples.innerText = msg.samples;

    window.noAudioInputInstructions.style.display = "none";

    if (msg.p50 !== undefined) {
      const latency_range = msg.p60 - msg.p40;
      window.est40to60.innerText = Math.round(latency_range) + "ms";
      window.estLatency.innerText = Math.round(msg.p50) + "ms";
      window.msClietLatency.value = Math.round(msg.p50) + "ms";

      if (latency_range < msg.samples / 2) {
        // Stop trying to estimate latency once were close enough. The
        // more claps the person has done, the more we lower our
        // standards for close enough, figuring that they're having
        // trouble clapping on the beat.
        send_local_latency();
        window.initialInstructions.style.display = "none";
        window.calibration.style.display = "none";
        window.runningInstructions.style.display = "block";
        set_estimate_latency_mode(false);
      }
    }
    return;
  } else if (msg.type != "samples_out") {
    lib.log(LOG_ERROR, "Got message of unknown type:", msg);
    stop();
    return;
  }

  //XXX lib.log_every(10, "audioCtx", LOG_DEBUG, "audioCtx:", audioCtx);
  var mic_samples = msg.samples;
  mic_buf.push(mic_samples);

  var peak_in = parseFloat(peak_in_text.value);
  if (isNaN(peak_in)) {
    peak_in = 0.0;
  }

  if (mic_buf.length >= sample_batch_size) {
    // Resampling here works automatically for now since we're copying sample-by-sample
    var outdata = new sample_encoding["client"](mic_buf.length * mic_samples.length);
    if (msg.clock !== null) {
      for (var i = 0; i < mic_buf.length; i++) {
        for (var j = 0; j < mic_buf[i].length; j++) {
          if (Math.abs(mic_buf[i][j]) > peak_in) {
            peak_in = Math.abs(mic_buf[i][j]);
          }
          outdata[i * mic_buf[0].length + j] = sample_encoding["send"](mic_buf[i][j]);
        }
      }
      // XXX: touching the DOM
      peak_in_text.value = peak_in;
    } else {
      // Still warming up
      for (var i = 0; i < mic_buf.length; i++) {
        for (var j = 0; j < mic_buf[i].length; j++) {
          if (mic_buf[i][j] !== 0) {
            lib.log_every(12800, "nonzero_warmup", LOG_ERROR, "Nonzero mic data during warmup, huh?");
            //throw "Nonzero mic data during warmup, huh?"
          }
        }
      }
    }
    mic_buf = [];

    if (loopback_mode == "main") {
      lib.log(LOG_DEBUG, "looping back samples in main thread");
      var result = new Float32Array(outdata.length);
      for (var i = 0; i < outdata.length; i++) {
        result[i] = sample_encoding["recv"](outdata[i]);
      }
      // Clocks are at the _end_ of intervals; the longer we've been
      //   accumulating data, the more we have to read. (Trust me.)
      read_clock += outdata.length;
      samples_to_worklet(result, read_clock);
      return;
    }

    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = () => {
      if (xhr.readyState == 4 /* done*/) {
        handle_xhr_result(xhr);
      }
    };
    xhr.debug_id = Date.now();

    try {
      var target_url = new URL(server_path, document.location);
      var params = new URLSearchParams();
      // Response size always equals request size.
      // Clocks are at the _end_ of intervals; the longer we've been
      //   accumulating data, the more we have to read. (Trust me.)
      read_clock += outdata.length;
      params.set('read_clock', read_clock);
      if (msg.clock !== null) {
        params.set('write_clock', msg.clock);
      }
      if (loopback_mode == "server") {
        params.set('loopback', true);
        lib.log(LOG_DEBUG, "looping back samples at server");
      }
      const username = window.userName.value;
      params.set('username', username);
      params.set('userid', userid);

      if (chatsToSend.length) {
        params.set('chat', JSON.stringify(chatsToSend));
        chatsToSend = [];
      }
      if (requestedLeadPosition) {
        params.set('request_lead', '1');
        requestedLeadPosition = false;
      }

      target_url.search = params.toString();

      // Arbitrary cap; browser cap is 8(?) after which they queue
      if (xhrs_inflight >= 4) {
        lib.log(LOG_WARNING, "NOT SENDING XHR w/ ID:", xhr.debug_id, " due to limit -- already in flight:", xhrs_inflight);
        try_increase_batch_size_and_reload();
        return
      }

      lib.log(LOG_SPAM, "Sending XHR w/ ID:", xhr.debug_id, "already in flight:", xhrs_inflight++, "; data size:", outdata.length);
      xhr.open("POST", target_url, true);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.responseType = "arraybuffer";
      xhr.send(outdata);
      lib.log(LOG_SPAM, "... XHR sent.");
    } catch(e) {
      lib.log(LOG_ERROR, "Failed to make XHR:", e);
      stop();
      return;
    }
  }
}

var peak_out = parseFloat(peak_out_text.value);
if (isNaN(peak_out)) {
  peak_out = 0.0;
}

function update_active_users(user_summary) {
  // Delete previous users.
  while (window.activeUsers.firstChild) {
    window.activeUsers.removeChild(window.activeUsers.lastChild);
  }

  for (var i = 0; i < user_summary.length; i++) {
    const offset_s = Math.round(user_summary[i][0] / sample_rate);
    const name = user_summary[i][1];
    const tr = document.createElement('tr');

    const td1 = document.createElement('td');
    td1.textContent = offset_s;
    tr.appendChild(td1);

    const td2 = document.createElement('td');
    td2.textContent = name;
    tr.appendChild(td2);

    window.activeUsers.appendChild(tr);
  }
}


// Only called when readystate is 4 (done)
function handle_xhr_result(xhr) {
  if (!running) {
    lib.log(LOG_WARNING, "Got XHR onreadystatechange w/ID:", xhr.debug_id, "for xhr:", xhr, " when done running; still in flight:", --xhrs_inflight);
    return;
  }

  if (xhr.status == 200) {
    var metadata = JSON.parse(xhr.getResponseHeader("X-Audio-Metadata"));
    lib.log(LOG_DEBUG, "metadata:", metadata);
    var result = new sample_encoding["client"](xhr.response);
    var play_samples = new Float32Array(result.length);
    for (var i = 0; i < result.length; i++) {
      play_samples[i] = sample_encoding["recv"](result[i]);
      if (Math.abs(play_samples[i]) > peak_out) {
        peak_out = Math.abs(play_samples[i]);
      }
    }

    lib.log(LOG_SPAM, "Got XHR response w/ ID:", xhr.debug_id, "result:", result, " -- still in flight:", --xhrs_inflight);
    if (metadata["kill_client"]) {
      lib.log(LOG_ERROR, "Received kill from server");
      reload_settings();
      return;
    }
    samples_to_worklet(play_samples, metadata["client_read_clock"]);

    var queue_size = metadata["queue_size"];
    var user_summary = metadata["user_summary"];
    var chats = metadata["chats"];
    var delay_samples = metadata["delay_samples"];

    // Defer touching the DOM, just to be safe.
    requestAnimationFrame(() => {
      if (delay_samples) {
        delay_samples = parseInt(delay_samples, 10);
        if (delay_samples > 0) {
          audio_offset_text.value = Math.round(delay_samples / sample_rate);
          audio_offset_change();
        }
      }

      update_active_users(user_summary);

      chats.forEach((msg) => receiveChatMessage(msg[0], msg[1]));

      peak_out_text.value = peak_out;

      client_total_time.value = (metadata["client_read_clock"] - metadata["client_write_clock"] + play_samples.length) / sample_rate;
      client_read_slippage.value = (metadata["server_clock"] - metadata["client_read_clock"] - audio_offset) / sample_rate;
    });
  } else {
    lib.log(LOG_ERROR, "XHR failed w/ ID:", xhr.debug_id, "stopping:", xhr, " -- still in flight:", --xhrs_inflight);

    try_increase_batch_size_and_reload();
    return;
  }
}

function try_increase_batch_size_and_reload() {
  if (sample_batch_size < max_sample_batch_size) {
    // Try increasing the batch size and restarting.
    sample_batch_size *= 1.3;  // XXX: do we care that this may not be integral??
    window.msBatchSize.value = batches_to_ms(sample_batch_size);
    reload_settings();
    return;
  } else {
    set_error("Failed to communicate with the server at a reasonable latency");
    stop();
  }
}

async function stop() {
  window.initialInstructions.style.display = "block";
  window.calibration.style.display = "none";
  window.runningInstructions.style.display = "none";
  window.noAudioInputInstructions.style.display = "none";

  window.estSamples.innerText = "...";
  window.est40to60.innerText = "...";
  window.estLatency.innerText = "...";

  if (muted) {
    toggle_mute();
  }

  lib.log(LOG_INFO, "Closing audio context and mic stream...");
  if (audioCtx) {
    await audioCtx.close();
    audioCtx = undefined;
  }
  if (micStream) {
    close_stream(micStream);
    micStream = undefined;
  }
  lib.log(LOG_INFO, "...closed.");
}

start_button.addEventListener("click", start_stop);
mute_button.addEventListener("click", toggle_mute);
click_volume_slider.addEventListener("change", click_volume_change);
audio_offset_text.addEventListener("change", audio_offset_change);

log_level_select.addEventListener("change", () => {
  lib.set_log_level(parseInt(log_level_select.value));
  if (playerNode) {
    playerNode.port.postMessage({
      type: "log_params",
      log_level: lib.log_level
    });
  }
});

var coll = document.getElementsByClassName("collapse");
for (var i = 0; i < coll.length; i++) {
  coll[i].addEventListener("click", function() {
    //this.classList.toggle("active");
    var otherlabel = this.dataset.otherlabel;
    this.dataset.otherlabel = this.textContent;
    this.textContent = otherlabel;
    var content = this.nextElementSibling;
    if (content.style.display === "block") {
      content.style.display = "none";
    } else {
      content.style.display = "block";
    }
  });
}

initialize();
