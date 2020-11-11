-- a/html/BucketSingingClient.js
const APP_TUTORIAL = "tutorial";
const APP_INITIALIZING = "initializing";
const APP_STOPPED = "stopped";
const APP_STARTING = "starting";
const APP_RUNNING = "running";
const APP_CALIBRATING_LATENCY = "calibrating_latency";
const APP_CALIBRATING_VOLUME = "calibrating_volume";
const APP_STOPPING = "stopping";
const APP_RESTARTING = "restarting";

addEventListener('error', (event) => {
  if (document.getElementById('crash').style.display) {
    return;
  }
  event.preventDefault();
  document.getElementById('crash').style.display = 'block';
  const {name, message, stack, unpreventable} = event.error ?? {};
  if (unpreventable) {
    document.getElementById('crashMessage').textContent = message;
  } else {
    document.getElementById('crashBug').style.display = 'block';
    document.getElementById('crashTrace').textContent = `${name}: ${message}\n${stack}`;
  }
});
addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  throw event.reason;
});

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

lib.log(LOG_INFO, "Starting up");

function prettyTime(ms) {
  if (ms < 1000) {
    return "0s";
  }
  const sec = Math.round(ms / 1000);
  if (sec < 60) {
    return sec + "s";
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return min + "m";
  }
  const hr = Math.round(min / 60);
  if (hr < 24) {
    return hr + "h";
  }
  const d = Math.round(hr / 24);
  return d + "d";
}

function update_calendar() {
  fetch('https://www.googleapis.com/calendar/v3/calendars/gsc268k1lu78lbvfbhphdr0cs4@group.calendar.google.com/events?key=AIzaSyCDAG5mJmnmi9EaR5SujP70x8kLKOau4Is')
    .then(response => response.json())
    .then(data => {
      let currentEvent = null;
      let upcomingEvent = null;
      const now = Date.now();

      if ( ! data.items ) {
        // TODO: Save the error code?
        lib.log(LOG_WARNING, "No data from Google Calendar");
        return;
      }

      data.items.forEach(item => {
        // If an event is currently happening we want to check whether
        // that's what people are here for. Similarly, if an event is
        // going to be starting soon we should give people a heads up.
        if (item.status === "confirmed") {
          const msUntilStart = Date.parse(item.start.dateTime) - now;
          const msUntilEnd = Date.parse(item.end.dateTime) - now;
          const organizer = item.organizer.displayName || item.organizer.email;
          console.log(item.summary + " [" + msUntilStart + ":" + msUntilEnd + "]");
          if (msUntilStart <= 0 && msUntilEnd > 0) {
            currentEvent = {
              summary: item.summary,
              remainingMs: msUntilEnd,
              organizer: organizer,
            };
          } else if (msUntilStart > 0) {
            if (!upcomingEvent || upcomingEvent.futureMs > msUntilStart) {
              upcomingEvent = {
                summary: item.summary,
                futureMs: msUntilStart,
                organizer: organizer,
              }
            }
          }
        }
      });

      if (currentEvent) {
        window.currentEvent.innerText = "Current Event: " + currentEvent.summary;
        window.eventWelcome.innerText =
          "Right now " + currentEvent.organizer + " is running \"" +
          currentEvent.summary + "\".  If you were invited to attend, great! " +
          "Otherwise, please come back later.";
      } else if (upcomingEvent) {
        window.currentEvent.innerText = "Next Event: \"" + upcomingEvent.summary +
          "\" in " + prettyTime(upcomingEvent.futureMs);
        if (upcomingEvent.futureMs < 60*60*1000) {
          window.eventWelcome.innerText =
            "There are no events right now, but in " +
            prettyTime(upcomingEvent.futureMs) + " " +
            upcomingEvent.organizer + " is running \"" +
            upcomingEvent.summary + "\".";
        }
      } else {
        window.currentEvent.innerText = "No Events Scheduled";
      }
    });
}
update_calendar();

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

window.chatForm.addEventListener("submit", (e) => { sendChatMessage(); e.preventDefault(); });

let leadButtonState = "take-lead";
let requestedLeadPosition = false;
let markStartSinging = false;
let markStopSinging = false;
function takeLeadClick() {
  if (leadButtonState == "take-lead") {
    requestedLeadPosition = true;
    // Action doesn't take effect until server confirms.
  } else if (leadButtonState == "start-singing") {
    window.takeLead.textContent = "Stop Singing";
    markStartSinging = true;
    leadButtonState = "stop-singing";
  } else if (leadButtonState == "stop-singing") {
    window.takeLead.textContent = "Lead a Song";
    markStopSinging = true;
    leadButtonState = "take-lead";
    window.jumpToEnd.disabled = false;
  } else {
    throw new Error("unknown state " + leadButtonState);
  }
}

window.takeLead.addEventListener("click", takeLeadClick);

window.jumpToEnd.addEventListener("click", () => {
  audio_offset_text.value = 115;
  audio_offset_change();
});

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

function persist_checkbox(checkboxId) {
  const checkbox = document.getElementById(checkboxId);
  const prevVal = localStorage.getItem(checkboxId);
  checkbox.checked = (prevVal === "true");

  checkbox.addEventListener("change", () => {
    localStorage.setItem(checkboxId, checkbox.checked);
  });
}

persist("userName");
persist_checkbox("disableTutorial");
persist_checkbox("disableLatencyMeasurement");
// Persisting select boxes is harder, so we do it manually for inSelect.

function setMainAppVisibility() {
  if (window.userName.value && app_state != APP_TUTORIAL) {
    window.mainApp.style.display = "block";
  }
setMainAppVisibility();
window.userName.addEventListener("change", setMainAppVisibility);
var in_select = document.getElementById('inSelect');
var click_bpm = document.getElementById('clickBPM');
in_select.addEventListener("change", in_select_change);
async function enumerate_devices() {
  navigator.mediaDevices.enumerateDevices().then((devices) => {
    // Clear existing entries
    in_select.options.length = 0;

    devices.forEach((info) => {
      var el = document.createElement("option");
      el.value = info.deviceId;
      if (info.kind === 'audioinput') {
        el.text = info.label || 'Unknown Input';
        if (info.deviceId && localStorage.getItem("inSelect") === info.deviceId) {
          el.selected = true;
        }
        in_select.appendChild(el);
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

    el = document.createElement("option");
    el.value = "CLICKS";
    el.text = "CLICKS";
    in_select.appendChild(el);

    el = document.createElement("option");
    el.value = "ECHO";
    el.text = "ECHO";
    in_select.appendChild(el);
  });
}

var audioCtx;

var start_button = document.getElementById('startButton');
var click_volume_slider = document.getElementById('clickVolumeSlider');
var disable_latency_measurement_checkbox = document.getElementById('disableLatencyMeasurement');
var loopback_mode_select = document.getElementById('loopbackMode');
var server_path_text = document.getElementById('serverPath');
var audio_offset_text = document.getElementById('audioOffset');
var web_audio_output_latency_text = document.getElementById('webAudioOutputLatency');
var latency_compensation_label = document.getElementById('latencyCompensationLabel');
var latency_compensation_apply_button = document.getElementById('latencyCompensationApply');
var sample_rate_text = document.getElementById('sampleRate');
var peak_in_text = document.getElementById('peakIn');
var peak_out_text = document.getElementById('peakOut');
var client_total_time = document.getElementById('clientTotalTime');
var client_read_slippage = document.getElementById('clientReadSlippage');

export var start_hooks = [];
export var stop_hooks = [];
export var event_hooks = [];
var event_data = [];
var alarms = {};
var alarms_fired = {};
var cur_clock_cbs = [];

export function declare_event(evid, offset) {
  cur_clock_cbs.push( (clock)=>{ event_data.push({evid,clock:clock-(offset||0)*audioCtx.sampleRate}); } );
function allStatesExcept(states) {
  return [...ALL_STATES].filter(state => !states.includes(state));
}


function setVisibleIn(element, enabled_states, visible='block') {
  element.style.display = enabled_states.includes(app_state) ? visible : 'none';
}

function setEnabledIn(element, enabled_states) {
  element.disabled = !enabled_states.includes(app_state);
}


function set_controls() {
  setVisibleIn(window.micToggleButton, [APP_RUNNING]);
  setVisibleIn(window.speakerToggleButton, [APP_RUNNING]);

  setEnabledIn(loopback_mode_select, [APP_STOPPED])
  setEnabledIn(click_bpm, allStatesExcept([APP_STOPPED]));

  setEnabledIn(in_select, allStatesExcept([APP_INITIALIZING, APP_RESTARTING]));
  setEnabledIn(start_button, allStatesExcept([APP_INITIALIZING, APP_RESTARTING]));

  setVisibleIn(start_button, allStatesExcept([APP_TUTORIAL]));

  setVisibleIn(window.tutorial, [APP_TUTORIAL]);

  start_button.textContent = ". . .";
  if (app_state == APP_STOPPED) {
    start_button.textContent = "Start";
  } else if (app_state != APP_INITIALIZING) {
    start_button.textContent = "Stop";
  }

  setVisibleIn(window.pleaseBeKind, allStatesExcept(ACTIVE_STATES));
  setVisibleIn(window.inputSelector,
               allStatesExcept(ACTIVE_STATES.concat([APP_TUTORIAL])));
  setVisibleIn(window.nameSelector,
               allStatesExcept(ACTIVE_STATES.concat([APP_TUTORIAL])));
  setEnabledIn(window.songControls, allStatesExcept([APP_RESTARTING]));
  setEnabledIn(window.chatPost, allStatesExcept([APP_RESTARTING]));
  setEnabledIn(audio_offset_text, allStatesExcept([APP_RESTARTING]));

  setVisibleIn(window.micToggleButton, [APP_RUNNING, APP_RESTARTING], "inline-block");
  setVisibleIn(window.speakerToggleButton, [APP_RUNNING, APP_RESTARTING], "inline-block");

  setVisibleIn(window.initialInstructions, [
    APP_INITIALIZING, APP_STOPPED, APP_CALIBRATING_LATENCY, APP_STOPPING]);
  setVisibleIn(window.latencyCalibrationInstructions, [
    APP_INITIALIZING, APP_STOPPED, APP_CALIBRATING_LATENCY, APP_STOPPING]);

  setVisibleIn(window.calibration, [APP_CALIBRATING_LATENCY]);

  setVisibleIn(window.volumeCalibration, [APP_CALIBRATING_VOLUME]);
  setEnabledIn(window.startVolumeCalibration, [APP_CALIBRATING_VOLUME]);

  setVisibleIn(window.runningInstructions, [APP_RUNNING, APP_RESTARTING]);

  setVisibleIn(window.noAudioInputInstructions, []);

  window.estSamples.innerText = "...";
  window.est40to60.innerText = "...";
  window.estLatency.innerText = "...";

  window.backingTrack.display = "none";

  setMainAppVisibility();
}

function in_select_change() {
  window.localStorage.setItem("inSelect", in_select.value);
  reset_if_running();
}

async function configure_input_node(audioCtx) {
  var deviceId = in_select.value;
    var buffer = audioCtx.createBuffer(1, 128, audioCtx.sampleRate);
    var source = audioCtx.createBufferSource();
  return new MediaStreamAudioSourceNode(audioCtx, { mediaStream: micStream });
function configure_output_node(audioCtx) {
  return audioCtx.destination;
var app_state = APP_TUTORIAL;
if (window.disableTutorial.checked) {
   app_state = APP_INITIALIZING;
}

var app_initialized = false;

const ALL_STATES = [
  APP_TUTORIAL, APP_INITIALIZING, APP_STOPPED, APP_STARTING, APP_RUNNING,
  APP_CALIBRATING_LATENCY, APP_CALIBRATING_VOLUME, APP_STOPPING,
  APP_RESTARTING];

const ACTIVE_STATES = [
  APP_RUNNING, APP_CALIBRATING_LATENCY, APP_CALIBRATING_VOLUME, APP_RESTARTING
];

function switch_app_state(newstate) {
  lib.log(LOG_INFO, "Changing app state from", app_state, "to", newstate, ".");
  app_state = newstate;
  set_controls();
}
set_controls();

function ms_to_samples(ms) {
  return audioCtx.sampleRate * ms / 1000;
}

function samples_to_ms(samples) {
  return samples * 1000 / audioCtx.sampleRate;
}

function ms_to_batch_size(ms) {
  return Math.round(ms_to_samples(ms) / 128);
}

function batch_size_to_ms(batch_size) {
  return Math.round(samples_to_ms(batch_size * 128));
}
function set_estimate_latency_mode(mode) {
  playerNode.port.postMessage({
    "enabled": mode
function set_estimate_volume_mode(mode) {
    "enabled": mode
function click_volume_change() {
    "value": click_volume_slider.value
var micPaused = false;
function toggle_mic() {
  micPaused = !micPaused;
  window.micToggleImg.alt = micPaused ? "turn mic on" : "turn mic off";
  window.micToggleImg.src =
    "images/mic-" + (micPaused ? "off" : "on") + ".png";
    "enabled": micPaused
var speakerPaused = false;
function toggle_speaker() {
  speakerPaused = !speakerPaused;
  window.speakerToggleImg.alt = speakerPaused ? "turn speaker on" : "turn speaker off";
  window.speakerToggleImg.src =
    "images/speaker-" + (speakerPaused ? "off" : "on") + ".png";
    "enabled": speakerPaused

async function reset_if_running() {
  if (app_state == APP_RUNNING) {
    await stop();
    await start();
  }
}

async function audio_offset_change() {
  const new_value = parseInt(audio_offset_text.value);
  // TODO: stop using magic numbers about the buffer size
  if (isNaN(new_value) || new_value < 1 || new_value > 115) {
    audio_offset_text.value = 115;
  }

  if (app_state == APP_RUNNING) {
    await restart();
  }
}

async function start_stop() {
  if (app_state == APP_RUNNING) {
    await stop();
  } else if (app_state == APP_STOPPED) {
    await start();
  } else {
    lib.log(LOG_WARNING, "Pressed start/stop button while not stopped or running; stopping by default.");
    await stop();
  }
async function start() {
  switch_app_state(APP_STARTING);

  if (audioCtx) {
  audioCtx = new AudioContext({latencyHint: 'playback'});
  var micNode = await configure_input_node(audioCtx);
  var spkrNode = await configure_output_node(audioCtx);
// Should really be named "restart everything", which is what it does.
async function reload_settings(startup) {
  lib.log(LOG_INFO, "Resetting the world! Old epoch was:", epoch);
  epoch +=1;
  lib.log(LOG_INFO, "New epoch is:", epoch);

  // XXX: Not guaranteed to be immediate; we should wait for it to confirm.
  playerNode.port.postMessage({
    type: "stop"
  });

  if (server_connection) {
    server_connection.stop();
    server_connection = null;
  }

  lib.log(LOG_INFO, "Stopped audio worklet and server connection.");

  mic_buf = [];

  loopback_mode = loopback_mode_select.value;

  if (loopback_mode == "none" || loopback_mode == "server") {
    server_connection = new ServerConnection({
      // Support relative paths
      target_url: new URL(server_path_text.value, document.location),
      audio_offset_seconds: parseInt(audio_offset_text.value),
      userid: myUserid,
      epoch
    })
  } else {
    server_connection = new FakeServerConnection({
      sample_rate: 48000,
      epoch
    })
  }

  lib.log(LOG_INFO, "Created new server connection, resetting encoder and decoder.");

  await encoder.reset();
  await decoder.reset();

  lib.log(LOG_INFO, "Reset encoder and decoder, starting audio worket again.");

  // Send this before we set audio params, which declares us to be ready for audio
  click_volume_change();
  var audio_params = {
    type: "audio_params",
    synthetic_source: synthetic_audio_source,
    click_interval: synthetic_click_interval,
    loopback_mode,
    epoch,
  }
  // This will reset the audio worklett, flush its buffer, and start it up again.
  playerNode.port.postMessage(audio_params);

  alarms_fired = {};
  for (let hook of start_hooks) {
    hook();
  }
}

export function init_events() {
function send_local_latency() {
var peak_out = parseFloat(peak_out_text.value);
if (isNaN(peak_out)) {
  peak_out = 0.0;
}

let previous_backing_track_str = "";
function update_backing_tracks(tracks) {
  if (JSON.stringify(tracks) == previous_backing_track_str) {
    return;
  }
  previous_backing_track_str = JSON.stringify(tracks);

  while (window.backingTrack.firstChild) {
    window.backingTrack.removeChild(window.backingTrack.firstChild);
  }

  const initialOption = document.createElement('option');
  initialOption.textContent = "[optional] backing track";
  window.backingTrack.appendChild(initialOption);

  for (var i = 0; i < tracks.length; i++) {
    const option = document.createElement('option');
    option.textContent = tracks[i];
    window.backingTrack.appendChild(option);
  }
}

let backingTrackToSend = null;
window.backingTrack.addEventListener("change", (e) => {
  backingTrackToSend = window.backingTrack.value;
});

let previous_user_summary_str = "";
let previous_mic_volume_inputs_str = "";

let imLeading = false;

function update_active_users(user_summary, server_sample_rate) {
  for (var i = 0; i < user_summary.length; i++) {
    const userid = user_summary[i][3];
    if (userid != myUserid) {
      const is_monitoring = user_summary[i][4];
      if (window.monitorUserToggle.amMonitoring && is_monitoring) {
        // If someone else has started monitoring, we're done.
        endMonitoring(/*server_initiated=*/true);
      }
    }
  }

  if (window.monitorUserToggle.amMonitoring) {
    return;
  }

  if (JSON.stringify(user_summary) == previous_user_summary_str) {
    return;
  }
  previous_user_summary_str = JSON.stringify(user_summary);

  // Delete previous users.
  while (window.activeUsers.firstChild) {
    window.activeUsers.removeChild(window.activeUsers.lastChild);
  }

  const mic_volume_inputs = [];
  for (var i = 0; i < user_summary.length; i++) {
    const offset_s = user_summary[i][0];
    const name = user_summary[i][1];
    const mic_volume = user_summary[i][2];
    const userid = user_summary[i][3];

    if (i === 0) {
      const wasLeading = imLeading;
      imLeading = (userid == myUserid && offset_s < 5);

      if (imLeading && !wasLeading) {
        window.takeLead.textContent = "Start Singing";
        leadButtonState = "start-singing";
        window.jumpToEnd.disabled = true;
        window.backingTrack.style.display = "block";
        window.backingTrack.selectedIndex = 0;
      } else if (!imLeading && wasLeading) {
        window.takeLead.textContent = "Lead a Song";
        leadButtonState = "take-lead";
        window.jumpToEnd.disabled = false;
        window.backingTrack.style.display = "none";
      }
    }

    mic_volume_inputs.push([name, userid, mic_volume]);

    const tr = document.createElement('tr');

    const td1 = document.createElement('td');
    td1.textContent = offset_s;
    tr.appendChild(td1);

    const td2 = document.createElement('td');
    td2.textContent = name;
    tr.appendChild(td2);

    window.activeUsers.appendChild(tr);
  }

  mic_volume_inputs.sort();
  if (JSON.stringify(mic_volume_inputs) != previous_mic_volume_inputs_str) {
    while (window.monitorUserSelect.firstChild) {
      window.monitorUserSelect.removeChild(window.monitorUserSelect.lastChild);
    }
    const initialOption = document.createElement('option');
    initialOption.textContent = "Select User";
    window.monitorUserSelect.appendChild(initialOption);

    for (var i = 0; i < mic_volume_inputs.length; i++) {
      const option = document.createElement('option');

      const name = mic_volume_inputs[i][0];
      const userid = mic_volume_inputs[i][1];
      const vol = mic_volume_inputs[i][2];

      option.textContent = (vol === 1.0) ? name : (name + " -- " + vol);
      option.username = name;
      option.userid = userid;
      option.mic_volume = vol;

      window.monitorUserSelect.appendChild(option);
    }
  }
  previous_mic_volume_inputs_str = JSON.stringify(mic_volume_inputs);
}

let monitoredUserIdToSend = null;

function endMonitoring(server_initiated) {
  if (micPaused) {
    toggle_mic();
  }
  window.monitorUserToggle.innerText = "Begin Monitoring";
  window.monitorUserToggle.amMonitoring = false;
  if (!server_initiated) {
    monitoredUserIdToSend = "end";
  }
}

function beginMonitoring(option) {
  if (!micPaused) {
    toggle_mic();
  }
  window.monitorUserToggle.innerText = "End Monitoring";
  window.monitorUserToggle.amMonitoring = true;
  startMonitoringUser(option);
}

function startMonitoringUser(option) {
  window.micVolumeSetting.userid = option.userid;
  window.micVolumeSetting.value = option.mic_volume;
  monitoredUserIdToSend = option.userid;
}

window.monitorUserSelect.addEventListener("change", (e) => {
  if (window.monitorUserToggle.amMonitoring) {
    if (window.monitorUserSelect.selectedIndex > 0) {
      const option = window.monitorUserSelect.children[
        window.monitorUserSelect.selectedIndex];
      if (option.userid) {
        startMonitoringUser(option);
        return;
      }
    }
    endMonitoring(/*server_initiated=*/false);
  }
});

window.monitorUserToggle.addEventListener("click", (e) => {
  if (window.monitorUserSelect.selectedIndex < 0) {
    return;
  }
  const option = window.monitorUserSelect.children[
    window.monitorUserSelect.selectedIndex];
  if (!window.monitorUserToggle.amMonitoring && !option.userid) {
    // Not monitoring and no one to monitor, nothing to do.
    return;
  }

  if (!window.monitorUserToggle.amMonitoring) {
    beginMonitoring(option);
  } else {
    endMonitoring(/*server_initiated=*/false);
  }
});

let micVolumesToSend = [];
window.micVolumeApply.addEventListener("click", (e) => {
  const option = window.monitorUserSelect.children[
    window.monitorUserSelect.selectedIndex];
  option.mic_volume = window.micVolumeSetting.value;
  option.textContent = option.username + " -- " + option.mic_volume;
  micVolumesToSend.push([window.micVolumeSetting.userid,
                         parseFloat(window.micVolumeSetting.value)]);
});

async function restart() {
  if (app_state === APP_RESTARTING) {
    return;
  }
  switch_app_state(APP_RESTARTING);
  await reload_settings();
  await server_connection.start();
  window.lostConnectivity.style.display = "none";
  switch_app_state(APP_RUNNING);
}

  if (app_state != APP_RUNNING &&
      app_state != APP_CALIBRATING_LATENCY &&
      app_state != APP_CALIBRATING_VOLUME) {
    lib.log(LOG_WARNING, "Trying to stop, but current state is not running or calibrating? Stopping anyway.");
  }
  switch_app_state(APP_STOPPING);

  if (micPaused) {
    toggle_mic();
  }

  if (speakerPaused) {
    toggle_speaker();
  }
  if (audioCtx) {
    await audioCtx.close();
    audioCtx = undefined;
  if (micStream) {
    close_stream(micStream);
    micStream = undefined;

  for (let hook of stop_hooks) {
    hook();
  }

  switch_app_state(APP_STOPPED);
start_button.addEventListener("click", start_stop);
window.micToggleButton.addEventListener("click", toggle_mic);
window.speakerToggleButton.addEventListener("click", toggle_speaker);
click_volume_slider.addEventListener("change", click_volume_change);
audio_offset_text.addEventListener("change", audio_offset_change);

window.startVolumeCalibration.addEventListener("click", () => {
  window.startVolumeCalibration.disabled = true;
  set_estimate_volume_mode(true);
});

let globalVolumeToSend = null;
window.globalVolumeControl.addEventListener("change", () => {
  globalVolumeToSend = window.globalVolumeControl.value;
});

let backingVolumeToSend = null;
window.backingVolumeControl.addEventListener("change", () => {
  backingVolumeToSend = window.backingVolumeControl.value;
});

log_level_select.addEventListener("change", () => {
  lib.set_log_level(parseInt(log_level_select.value));
  if (playerNode) {
    playerNode.port.postMessage({
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
async function initialize() {
  await wait_for_mic_permissions();
  await enumerate_devices();

  if (document.location.hostname == "localhost") {
    // Better default for debugging.
    server_path_text.value = "http://localhost:8081/"
  }

  app_initialized = true;
  if (app_state != APP_TUTORIAL) {
    switch_app_state(APP_STOPPED);
  }
}

function hide_buttons_and_append_answer(element, answer) {
  for (var i = 0; i < element.children.length; i++) {
    element.children[i].style.display = "none";
  }
  const b = document.createElement('b');
  b.innerText = answer;
  element.appendChild(b);
};

function tutorial_answer(button) {
  const answer = button.innerText;
  const question = button.parentElement.id;
  hide_buttons_and_append_answer(button.parentElement, button.innerText);
  if (question === "q_headphones_present") {
    if (answer == "Yes") {
      window.q_headphones_wired.style.display = 'block';
    } else {
      window.q_wired_headphones_available.style.display = 'block';
    }
  } else if (question === "q_wired_headphones_available") {
    if (answer == "Yes") {
      window.final_attach_wired.style.display = 'block';
    } else {
      window.final_no_headphones.style.display = 'block';
    }
  } else if (question === "q_headphones_wired") {
    if (answer == "Yes") {
      window.final_wired_headphones.style.display = 'block';
      document.querySelectorAll(".headphoneAdvice").forEach(
        (element) => element.style.display = 'inline');
    } else {
      window.final_detach_wireless.style.display = 'block';
    }
  }
}

function hide_tutorial() {
  window.tutorial.style.display = 'none';
  window.nameSelector.display = 'block';
  window.mainApp.display = 'block';

document.querySelectorAll(".dismiss_tutorial").forEach(
  (button) => button.addEventListener("click", () => {
    switch_app_state(app_initialized ? APP_STOPPED : APP_INITIALIZING);
  }));

document.querySelectorAll("#tutorial_questions button").forEach(
  (button) => button.addEventListener("click", () => tutorial_answer(button)));

initialize();

