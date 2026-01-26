// Main application logic
(function() {
  // Update copyright year
  const start = 2025;
  const now = new Date().getFullYear();
  if (now > start) { document.getElementById('year').textContent = '–' + now; }

  const audio = document.getElementById('audio');
      const art = document.getElementById('art');
      const meta = document.getElementById('meta');
      const turntable = document.getElementById('turntable');
      const platter = document.querySelector('.platter');
      const playBtn = document.getElementById('play');
      const prevBtn = document.getElementById('prev');
      const nextBtn = document.getElementById('next');
      const shuffleBtn = document.getElementById('shuffle');
      const repeatBtn = document.getElementById('repeat');
      const pitchBtn = document.getElementById('pitch');
      const speed = document.getElementById('speed');
      const speedVal = document.getElementById('speedVal');
      const volume = document.getElementById('volume');
      const volVal = document.getElementById('volVal');
      const blurb = document.getElementById('blurb');
      const VOL_KEY = 'vinyl_volume';
      const MUTE_KEY = 'vinyl_muted';
      const PLAYBACK_KEY = 'vinyl_last_playback_v1';
      const RM_OVERRIDE_KEY = 'vinyl_rm_override';
      const RM_MQL = matchMedia?.('(prefers-reduced-motion: reduce)');
      const defaultTitle = "bevvy's vinyl collection";
      const STATE_SAVE_INTERVAL = 3000;
      const easeDur = 900;
      const ARM_BASE_DEG = 90;
      const ARM_MIN = 2;
      const ARM_MAX = 26;
      const ARM_REST = 0;
      const ARM_EASE_FAST = 240;
      const ARM_EASE_SEEK = 180;
      const ARM_FOLLOW_HZ = 10;
      const ARM_PLATTER_EPS = 0.6;
      const armEl = document.getElementById('arm');

      const GEO = (() => {
        const CX = 100, CY = 100;
        const PX = 180, PY = 20;
        const D = Math.hypot(PX - CX, PY - CY);
        const L = 136;
        const R_OUTER = 78;
        const R_INNER = 44;

        const clamp01 = (x) => Math.min(1, Math.max(0, x));
        const phiFromR = (r) => {
          const c = (D*D + L*L - r*r) / (2*D*L);
          const cc = Math.min(1, Math.max(-1, c));
          return Math.acos(cc) * 180/Math.PI; // deg
        };
        const rFromPhi = (phiDeg) => {
          const c = Math.cos(phiDeg * Math.PI/180);
          const r2 = D*D + L*L - 2*D*L*c;
          return Math.sqrt(Math.max(0, r2));
        };

        const PHI_OUT = phiFromR(R_OUTER);
        const PHI_IN  = phiFromR(R_INNER);

        const norm = (x,a,b) => (x - a) / (b - a);
        const lerp = (t,a,b) => a + t*(b - a);

        function pToDegGeom(p){
          const pp  = clamp01(p);
          const r   = R_OUTER - pp * (R_OUTER - R_INNER);
          const phi = phiFromR(r);
          const t   = norm(phi, PHI_OUT, PHI_IN);
          return lerp(t, ARM_MIN, ARM_MAX);
        }

        function degToPGeom(deg){
          const t   = norm(deg, ARM_MIN, ARM_MAX);
          const phi = lerp(t, PHI_OUT, PHI_IN);
          const r   = rFromPhi(phi);
          const p   = (R_OUTER - r) / (R_OUTER - R_INNER);
          return clamp01(p);
        }

        return { pToDegGeom, degToPGeom };
      })();

      const seek = document.getElementById('seek');
      const tCur = document.getElementById('tCur');
      const tDur = document.getElementById('tDur');

      let i = 0;
      let shuffle = false;
      let repeatMode = 'off';
      let angle = 0;
      let lastTime = null;
      let rate = 1;
      let animFrame;
      let seekDragging = false;
      let spinVel = 0;
      let easing = false;
      let easeStart = 0;
      let easeStartVel = 0;
      let autoAdvancing = false;
      let shuffleOrder = null;
      let shuffleCursor = 0;
      let lastStateSave = 0;
      let unlockSecret = false;
      let slugToIdx = Object.create(null);
      let idxToSlug = [];
      let pendingResume = null;
      let prePlaySeekP = null;
      let armCurDeg = ARM_REST;
      let armTargetDeg = ARM_REST;
      let armEaseFrom = ARM_REST;
      let armEaseStart = 0;
      let armEaseDur = 0;
      let armAnimating = false;
      let scrubbing = false;
      let altLayout = false;
      let allowMotion = sessionStorage.getItem(RM_OVERRIDE_KEY) === 'allow';

      const secretConfig = {
        keyPattern: [38,38,40,40,37,39,37,39,66,65],
        modeFlag: "altLayout",
        action: () => {
          console.log("✨ unlocking secret visuals...");
          unlockSecret = true;
        },
        validate(seq) {
          return JSON.stringify(seq) === JSON.stringify(this.keyPattern);
        }
      };

      function reducesMotion() {
        const ov = sessionStorage.getItem(RM_OVERRIDE_KEY);
        if (ov === 'force-on')  return true;
        if (ov === 'force-off') return false;
        return !!RM_MQL?.matches;
      }

      RM_MQL?.addEventListener?.('change', () => ensureRAF());
      window.addEventListener('storage', (e) => {
        if (e.key === RM_OVERRIDE_KEY) ensureRAF();
      });

      function slugifyTitle(str){
        return String(str || '')
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .replace(/-{2,}/g, '-');
      }

      function buildSlugIndex(){
        slugToIdx = Object.create(null);
        idxToSlug = [];

        const seen = Object.create(null);
        tracks.forEach((t, idx) => {
          const base = slugifyTitle(t.title);
          let slug = base || String(idx);
          if (seen[slug]) {
            let n = ++seen[slug];
            while (seen[`${base}-${n}`]) n++;
            slug = `${base}-${n}`;
            seen[slug] = 1;
          } else {
            seen[slug] = 1;
          }
          slugToIdx[slug] = idx;
          idxToSlug[idx] = slug;
        });
      }

      function setArmByProgress(p){
        if (!armEl || !isFinite(p)) return;
        armTargetDeg = GEO.pToDegGeom(p);
      }

      function setArmImmediateDeg(deg){
        armCurDeg = deg;
        armTargetDeg = deg;
        if (armEl) armEl.style.transform = `rotate(${ARM_BASE_DEG + deg}deg)`;
      }

      function easeArmToDeg(deg, dur = ARM_EASE_FAST){
        armEaseFrom  = armCurDeg;
        armTargetDeg = deg;
        armEaseStart = performance.now();
        armEaseDur   = Math.max(60, dur);
        armAnimating = true;
        ensureRAF();
      }

      function isOnPlatterDeg(deg){ return deg >= (ARM_MIN + ARM_PLATTER_EPS); }

      function progToDeg(p){ return GEO.pToDegGeom(p); }

      function consumeTrackParam(){
        const idx = getIdxFromQuery();
        if (idx < 0) return false;

        i = idx;
        load(i, false);

        if (shuffle && Array.isArray(shuffleOrder)) {
          const pos = shuffleOrder.indexOf(i);
          if (pos !== -1) shuffleCursor = pos;
        }

        try {
          const clean = location.pathname + (location.hash || '');
          history.replaceState(null, '', clean);
        } catch {}

        return true;
      }

      function getIdxFromQuery(){
        const params = new URLSearchParams(location.search);
        const q = params.get('track');
        if (!q) return -1;
        const slug = slugifyTitle(q);
        return slugToIdx[slug] ?? -1;
      }

      function getShareURL(){
        const slug = idxToSlug?.[i] || slugifyTitle(tracks[i]?.title) || String(i);
        const url  = new URL(location.href);
        url.search = `?track=${slug}`;
        return url.toString();
      }

      function setBlurb(txt){
        if (!blurb) return;
        blurb.textContent = txt || '';
        blurb.classList.toggle('hidden', !txt);
      }

      async function copyText(txt){
        try {
          await navigator.clipboard.writeText(txt);
          return true;
        } catch {
          const ta = document.createElement('textarea');
          ta.value = txt;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(ta);
          return ok;
        }
      }

      (function wireShare(){
        const btn = document.getElementById('share');
        if (!btn) return;

        btn.addEventListener('click', async () => {
          const url = getShareURL();

          if (navigator.share) {
            try {
              await navigator.share({ title: document.title, url });
              return;
            } catch {}
          }

          const ok = await copyText(url);

          const old = btn.textContent;
          btn.textContent = ok ? 'copied!' : 'copy failed';
          btn.setAttribute('aria-live', 'polite');
          setTimeout(() => { btn.textContent = old; }, 1200);
        });
      })();

      function swapArt(url){
        if (altLayout) url = FAV("scooter.webp");
        try { art.setAttribute('fetchpriority', 'high'); } catch {}
        try { art.loading = 'eager'; } catch {}
        try { art.decoding = 'async'; } catch {}
        art.src = url;
      }

      if (unlockSecret) {
        console.log("🐇 down the rabbit hole...");
      }

      function setSource(track) {
        try { document.getElementById('preload-art')?.remove(); } catch {}
        try {
          const link = document.createElement('link');
          link.id = 'preload-art';
          link.rel = 'preload';
          link.as = 'image';
          link.href = track.art;
          link.fetchPriority = 'high';
          document.head.appendChild(link);
        } catch {}

        audio.preload = audio.paused ? 'none' : 'metadata';
        audio.src = track.src;
        swapArt(track.art);
        art.alt = `album art for ${track.title}`;
        meta.innerHTML = `<b>${track.title}</b> – ${track.artist}`;
        setBlurb(track.blurb);
        setLoading(!audio.paused);

        seek.value = 0;
        seek.max = 0;
        seek.disabled = true;
        tCur.textContent = '0:00';
        tDur.textContent = '--:--';
        document.title = defaultTitle;
      }

      function resetPlatterAngle(){
        platter.classList.add('snap-reset');
        angle = 0;
        platter.style.transform = 'rotate(0deg)';
        platter.addEventListener('transitionend', () => {
          platter.classList.remove('snap-reset');
        }, { once:true });
      }

      function syncRepeatUI(btn) {
        if (!btn) return;
        btn.textContent = `repeat: ${repeatMode}`;
        btn.setAttribute('aria-pressed', String(repeatMode !== 'off'));
      }

      function cycleRepeat() {
        repeatMode = repeatMode === 'off' ? 'one' : repeatMode === 'one' ? 'all' : 'off';
        audio.loop = repeatMode === 'one';
        syncRepeatUI(document.getElementById('repeat'));
      }

      function fyShuffle(arr){
        for (let m = arr.length - 1; m > 0; m--){
          const j = Math.floor(Math.random() * (m + 1));
          [arr[m], arr[j]] = [arr[j], arr[m]];
        }
        return arr;
      }

      function buildShuffleOrder(currentIdx){
        const n = tracks.length;
        const rest = Array.from({length:n},(_,k)=>k).filter(k=>k!==currentIdx);
        fyShuffle(rest);
        return [currentIdx, ...rest];
      }

      function getVisibleOrder(){
        if (!shuffle || !shuffleOrder) {
          return Array.from({length: tracks.length}, (_, k) => k);
        }
        return shuffleOrder.slice();
      }

      function findInVisibleOrder(idx){
        const order = getVisibleOrder();
        return { order, pos: order.indexOf(idx) };
      }

      function setPreservePitch(yes){
        try {
          if ('preservesPitch' in audio) audio.preservesPitch = yes;
          if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = yes;
          if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch =  yes;
        } catch(e) {}
      }

      function setRate(r){
        rate = Math.max(0.25, Math.min(2, Number(r)));
        audio.playbackRate = rate;
        if (speed) speed.value = String(rate);
        const txt = `${rate.toFixed(2)}×`;
        speedVal.textContent = txt;
        speed.setAttribute('aria-valuetext', txt);
      }

      function setVolume(v){
        const nv = Math.min(1, Math.max(0, Number(v)));
        audio.volume = nv;
        volume.value = String(nv);
        const txt = audio.muted ? 'muted' : Math.round(nv*100)+'%';
        volVal.textContent = txt;
        volume.setAttribute('aria-valuetext', txt);
        localStorage.setItem(VOL_KEY, String(nv));
      }
      function setMuted(on){
        audio.muted = !!on;
        volVal.textContent = on ? 'muted' : Math.round(audio.volume*100)+'%';
        sessionStorage.setItem(MUTE_KEY, on ? '1' : '0');
      }
      function bumpVolume(delta){
        if (audio.muted && delta > 0) setMuted(false);
        setVolume((audio.volume || 0) + delta);
      }

      function rpmToDegPerSec(rpm){ return (rpm * 360) / 60; }
      function currentDegPerSec(){ return rpmToDegPerSec(33.333 * rate); }

      function ensureRAF(){ if (!animFrame) animFrame = requestAnimationFrame(animateSpin); }
      function cancelRAF(){ if (animFrame) { cancelAnimationFrame(animFrame); animFrame = undefined; } }

      function startSpin(){
        easing = false;
        autoAdvancing = false;
        spinVel = currentDegPerSec();
        turntable.classList.add('playing');
        lastTime = null;
        ensureRAF();
      }

      function startEaseOut(){
        easing = true;
        autoAdvancing = false;
        easeStart = performance.now();
        easeStartVel = currentDegPerSec();
        ensureRAF();
      }

      function stopImmediate(){
        easing = false;
        autoAdvancing = false;
        spinVel = 0;
        turntable.classList.remove('playing');
        cancelRAF();
      }

      function playPause(){
        if (audio.paused) {
          if (prePlaySeekP == null && !isOnPlatterDeg(armCurDeg)) {
            easeArmToDeg(ARM_MIN, ARM_EASE_SEEK);
          }

          if (prePlaySeekP != null) {
            if (!(isFinite(audio.duration) && audio.duration > 0)) {
              audio.preload = 'metadata';
              const p = prePlaySeekP;
              prePlaySeekP = null;

              const applyAndPlay = () => {
                const d = audio.duration;
                if (isFinite(d) && d > 0) {
                  const t = clamp(d * p, 0, Math.max(0, d - 0.01));
                  audio.currentTime = t;
                  seek.value = t;
                  tCur.textContent = formatTime(t);
                  easeArmToDeg(progToDeg(p), ARM_EASE_FAST);
                }
                audio.play().then(()=>{ startSpin(); playBtn.textContent = '❚❚ pause'; }).catch(()=>{});
                audio.removeEventListener('loadedmetadata', applyAndPlay);
              };

              audio.addEventListener('loadedmetadata', applyAndPlay);
              return;
            } else {
              const d = audio.duration;
              const t = clamp(d * prePlaySeekP, 0, Math.max(0, d - 0.01));
              prePlaySeekP = null;
              audio.currentTime = t;
              seek.value = t;
              tCur.textContent = formatTime(t);
              easeArmToDeg(progToDeg((audio.currentTime||0)/d), ARM_EASE_FAST);
            }
          }

          audio.preload = 'none';
          audio.play().then(()=>{ startSpin(); playBtn.textContent = '❚❚ pause'; }).catch(()=>{});
        } else {
          audio.pause();
          playBtn.textContent = '► play';
          document.title = defaultTitle;
        }
      }

      function animateSpin(ts) {
        animFrame = undefined;

        const rm = reducesMotion();

        if (ts === undefined) ts = performance.now();
        if (lastTime === null) lastTime = ts;
        const dt = (ts - lastTime) / 1000;
        lastTime = ts;

        if (rm) {
          spinVel = 0;
        } else if (!audio.paused && !easing) {
          spinVel = currentDegPerSec();
        } else if (autoAdvancing) {
          spinVel = currentDegPerSec();
        } else if (easing) {
          const t = Math.min(1, (ts - easeStart) / easeDur);
          const k = Math.pow(1 - t, 3);
          spinVel = easeStartVel * k;
          if (t >= 1 || spinVel < 0.1) { spinVel = 0; easing = false; turntable.classList.remove('playing'); }
        } else {
          spinVel = 0;
        }

        if (spinVel > 0) {
          angle = (angle + spinVel * dt) % 360;
          platter.style.transform = `rotate(${angle}deg)`;
        }

        updateArm(ts, dt);

        if (
          rm ||
          !audio.paused ||
          easing ||
          autoAdvancing ||
          armAnimating ||
          scrubbing ||
          Math.abs(armTargetDeg - armCurDeg) > 0.02
        ) {
          animFrame = requestAnimationFrame(animateSpin);
        } else {
          cancelRAF();
        }
      }

      (function warmArtPolitely(){
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn?.saveData) return;
        if (['slow-2g','2g','3g'].includes(conn?.effectiveType)) return;

        const urls = [...new Set(tracks.map(t => t.art).filter(Boolean))];

        const q = urls.slice();
        const CONCURRENCY = 3;
        let inflight = 0;

        function kick() {
          while (inflight < CONCURRENCY && q.length) {
            const u = q.shift();
            inflight++;
            (window.requestIdleCallback
              ? (fn) => requestIdleCallback(fn, { timeout: 2000 })
              : (fn) => setTimeout(fn, 0))(() => {
                const img = new Image();
                img.decoding = 'async';
                img.referrerPolicy = 'no-referrer';
                img.onload = img.onerror = () => {
                  inflight--;
                  kick();
                };
                img.src = u;
              });
          }
        }

        addEventListener('load', kick);
      })();

      function next(){
        const shouldAutoplay = !audio.paused;
        if (!shouldAutoplay) easeArmToDeg(ARM_REST, ARM_EASE_FAST);

        if (shuffle && shuffleOrder) {
          shuffleCursor = (shuffleCursor + 1) % shuffleOrder.length;
          i = shuffleOrder[shuffleCursor];
          load(i, shouldAutoplay);
          renderPlaylist();
          return;
        }

        i = (i + 1) % tracks.length;
        load(i, shouldAutoplay);
        renderPlaylist();
      }

      function prev(){
        const shouldAutoplay = !audio.paused;
        if (!shouldAutoplay) easeArmToDeg(ARM_REST, ARM_EASE_FAST);

        if (shuffle && shuffleOrder) {
          shuffleCursor = (shuffleCursor - 1 + shuffleOrder.length) % shuffleOrder.length;
          i = shuffleOrder[shuffleCursor];
          load(i, shouldAutoplay);
          renderPlaylist();
          return;
        }

        i = (i - 1 + tracks.length) % tracks.length;
        load(i, shouldAutoplay);
        renderPlaylist();
      }

      function load(index, autoplay=false){
        if (pendingResume && pendingResume.idx !== index) pendingResume = null;

        if (!autoplay) {
          prePlaySeekP = null;

          autoAdvancing = false;
          scrubbing = false;
          easeArmToDeg(ARM_REST, ARM_EASE_FAST);
          ensureRAF();
        }

        i = index;
        setSource(tracks[i]);
        setRate(rate);

        if (autoplay) {
          easeArmToDeg(progToDeg(0), ARM_EASE_FAST);
          audio.currentTime = 0;
          audio.play().then(()=>{ startSpin(); playBtn.textContent = '❚❚ pause'; }).catch(()=>{});
        } else {
          autoAdvancing = false;
          scrubbing = false;

          stopImmediate();
          resetPlatterAngle();

          easeArmToDeg(ARM_REST, ARM_EASE_FAST);
          ensureRAF();

          playBtn.textContent = '► play';
        }
      }

      function formatTime(sec){
        if (!isFinite(sec)) return '--:--';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${String(s).padStart(2,'0')}`;
      }

      function onLoaded(){
        const d = audio.duration;
        if (isFinite(d) && d > 0) {
          seek.max = d;
          seek.disabled = false;
          tDur.textContent = formatTime(d);
          if (!audio.paused && !scrubbing){
            setArmByProgress((audio.currentTime || 0) / d);
          }
        } else {
          seek.max = 0;
          seek.disabled = true;
          tDur.textContent = '--:--';
          if (!audio.paused) setArmByProgress(0);
        }
        if (!seekDragging) tCur.textContent = formatTime(audio.currentTime || 0);
      }

      function onTimeUpdate(){
        if (seekDragging) return;
        const cur = audio.currentTime || 0;
        const d = audio.duration;
        seek.value = cur;
        tCur.textContent = formatTime(cur);
        if (isFinite(d) && d > 0) setArmByProgress(cur/d);
        savePlaybackState(false);
      }

      function ensureLoadFlag(){
        let f = document.getElementById('loadflag');
        if(!f){
          f = document.createElement('span');
          f.id = 'loadflag';
          f.className = 'loadflag';
          f.textContent = '(loading)';
          meta.appendChild(f);
        }
        return f;
      }
      function setLoading(on){
        ensureLoadFlag().classList.toggle('hidden', !on);
      }

      function savePlaybackState(force=false){
        const now = performance.now();
        if (!force && (now - lastStateSave) < STATE_SAVE_INTERVAL) return;
        lastStateSave = now;

        try {
          const payload = {
            idx: i,
            src: tracks[i]?.src || '',
            pos: Math.max(0, Math.floor(audio.currentTime || 0)),
            rate,
            repeatMode,
            shuffle: !!shuffle,
            fingerprint: tracks.map(t => (t?.title||'') + '|' + (t?.artist||'')),
            ts: Date.now()
          };
          sessionStorage.setItem(PLAYBACK_KEY, JSON.stringify(payload));
        } catch {}
      }

      function tryRestorePlaybackState(){
        try {
          const raw = sessionStorage.getItem(PLAYBACK_KEY);
          if (!raw) return false;
          const data = JSON.parse(raw);

          if (!Array.isArray(data.fingerprint) || data.fingerprint.length !== tracks.length) {
            return false;
          }

          let idx = typeof data.idx === 'number' ? data.idx : 0;
          if (tracks[idx]?.src !== data.src) {
            idx = tracks.findIndex(t =>
              t.src === data.src ||
              ((t.title||'') + '|' + (t.artist||'')) === data.fingerprint[data.idx]
            );
            if (idx < 0) idx = 0;
          }

          i = idx;
          setSource(tracks[i]);
          setRate(typeof data.rate === 'number' ? data.rate : rate);
          repeatMode = data.repeatMode || 'off';
          syncRepeatUI(document.getElementById('repeat'));

          const targetPos = Number(data.pos) || 0;
          pendingResume = { idx, pos: targetPos };

          const onMeta = () => {
            if (pendingResume && i === pendingResume.idx) {
              const d = audio.duration;
              const p = Math.min(Math.max(0, pendingResume.pos), isFinite(d) ? Math.max(0, d - 0.01) : pendingResume.pos);
              audio.currentTime = p;
              seek.value = p;
              tCur.textContent = formatTime(p);
            }
            pendingResume = null;
            audio.removeEventListener('loadedmetadata', onMeta);
          };
          audio.addEventListener('loadedmetadata', onMeta);

          renderPlaylist?.();
          highlightPlaylist(i);

          return true;
        } catch {
          return false;
        }
      }

      addEventListener('beforeunload', () => {
        savePlaybackState(true);
      });

      playBtn.addEventListener('click', playPause);
      prevBtn.addEventListener('click', prev);
      nextBtn.addEventListener('click', next);
      repeatBtn.addEventListener('click', cycleRepeat);

      shuffleBtn.addEventListener('click', () => {
        shuffle = !shuffle;
        shuffleBtn.setAttribute('aria-pressed', String(shuffle));
        shuffleBtn.textContent = shuffle ? 'shuffle (on)' : 'shuffle';

        if (shuffle) {
          shuffleOrder  = buildShuffleOrder(i);
          shuffleCursor = 0;
        } else {
          shuffleOrder  = null;
          shuffleCursor = 0;
        }

        renderPlaylist();
      });

      pitchBtn.addEventListener('click', () => {
        const on = pitchBtn.getAttribute('aria-pressed') === 'true';
        pitchBtn.setAttribute('aria-pressed', String(!on));
        pitchBtn.textContent = !on ? 'preserve pitch (on)' : 'preserve pitch';
        setPreservePitch(!on);
      });

      speed.addEventListener('input', (e) => setRate(e.target.value));
      speed.addEventListener('change', () => speed.blur());

      (function enableSpeedReset(){
        if (!speedVal) return;
        speedVal.title = 'click to reset speed to 1.00×';
        speedVal.tabIndex = 0;

        function resetSpeed(){
          setRate(1);
          speedVal.animate?.([{opacity: .6},{opacity: 1}], {duration: 180, easing: 'ease-out'});
        }

        speedVal.addEventListener('click', resetSpeed);
        speedVal.addEventListener('keydown', (e)=>{
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resetSpeed(); }
        });
      })();

      seek.addEventListener('pointerdown', () => {
        seekDragging = true;
        scrubbing = true;
        ensureRAF();
      });

      seek.addEventListener('input', (e) => {
        const v = Number(e.target.value);
        tCur.textContent = formatTime(v);

        const d = (isFinite(audio.duration) && audio.duration > 0)
          ? audio.duration
          : (isFinite(seek.max) ? Number(seek.max) : 0);

        if (d > 0){
          const p = v / d;

          if (scrubbing) {
            setArmByProgress(p);
          } else {
            easeArmToDeg(progToDeg(p), ARM_EASE_SEEK);
          }
        }

        ensureRAF();
      });

      seek.addEventListener('pointerup', () => {
        const v = Number(seek.value);
        audio.currentTime = isFinite(v) ? v : 0;
        seekDragging = false;
        scrubbing = false;

        const d = (isFinite(audio.duration) && audio.duration > 0) ? audio.duration : 0;
        if (d > 0) easeArmToDeg(progToDeg((audio.currentTime || 0) / d), ARM_EASE_SEEK);

        seek.blur();
      });

      seek.addEventListener('change', (e) => {
        const v = Number(e.target.value);
        audio.currentTime = isFinite(v) ? v : 0;
        seekDragging = false;
        scrubbing = false;
        const d = (isFinite(audio.duration) && audio.duration > 0) ? audio.duration : 0;
        if (d > 0) easeArmToDeg(progToDeg((audio.currentTime || 0) / d), ARM_EASE_SEEK);
      });

      audio.addEventListener('loadedmetadata', onLoaded);
      audio.addEventListener('durationchange', onLoaded);
      audio.addEventListener('timeupdate', onTimeUpdate);

      audio.addEventListener('pause', () => {
        if (audio.ended || autoAdvancing) return;
        startEaseOut();
        savePlaybackState(true);
      });

      audio.addEventListener('ended', () => {
        seek.value = seek.max || 0;

        if (repeatMode === 'one') { audio.currentTime = 0; audio.play().catch(()=>{}); return; }

        if (shuffle && shuffleOrder) {
          const atLast = shuffleCursor >= shuffleOrder.length - 1;

          if (!atLast) {
            autoAdvancing = true;
            ensureRAF();
            shuffleCursor += 1;
            i = shuffleOrder[shuffleCursor];
            load(i, true);
            renderPlaylist();
            return;
          }

          if (repeatMode === 'all') {
            autoAdvancing = true;
            ensureRAF();
            shuffleCursor = 0;
            i = shuffleOrder[0];
            load(i, true);
            renderPlaylist();
            return;
          }

          startEaseOut();
          playBtn.textContent = '► play';
          turntable.classList.remove('playing');
          return;
        }

        const atLast = i >= tracks.length - 1;

        if (!atLast) {
          autoAdvancing = true;
          ensureRAF();
          i = i + 1;
          load(i, true);
          renderPlaylist();
          return;
        }

        if (repeatMode === 'all') {
          autoAdvancing = true;
          ensureRAF();
          i = 0;
          load(i, true);
          renderPlaylist();
          return;
        }

        startEaseOut();
        playBtn.textContent = '► play';
        turntable.classList.remove('playing');
      });

      function updateArm(ts, dt){
        if (!armEl) return;

        const d = audio.duration;
        if (!audio.paused && !scrubbing && isFinite(d) && d > 0){
          armTargetDeg = progToDeg((audio.currentTime || 0) / d);
        }

        let nextDeg = armCurDeg;
        if (armAnimating){
          const t = Math.min(1, (ts - armEaseStart) / armEaseDur);
          const eased = 1 - Math.pow(1 - t, 3);
          const dtc = Math.min(dt, 1/30);
          const alpha = Math.min(1, dtc * ARM_FOLLOW_HZ);
          nextDeg = armCurDeg + (armTargetDeg - armCurDeg) * alpha;
          if (t >= 1) armAnimating = false;
        } else {
          const alpha = Math.min(1, dt * ARM_FOLLOW_HZ);
          nextDeg = armCurDeg + (armTargetDeg - armCurDeg) * alpha;
        }

        if (Math.abs(nextDeg - armCurDeg) > 0.001){
          armCurDeg = nextDeg;
          armEl.style.transform = `rotate(${ARM_BASE_DEG + armCurDeg}deg)`;
        }
      }

      audio.addEventListener('waiting', () => { if(!audio.paused) setLoading(true); });
      audio.addEventListener('stalled', () => { if(!audio.paused) setLoading(true); });
      audio.addEventListener('error',  () => setLoading(false));
      audio.addEventListener('playing', () => {
        setLoading(false);
        const t = tracks[i];
        document.title = `${t.title} – ${t.artist} | ${defaultTitle}`;

        const d = audio.duration;
        const cur = audio.currentTime || 0;
        if (isFinite(d) && d > 0) {
          easeArmToDeg(progToDeg(cur/d), ARM_EASE_FAST);
        }
      });

      if (volume) {
        const savedV = localStorage.getItem(VOL_KEY);
        const savedM = sessionStorage.getItem(MUTE_KEY) === '1';
        setVolume(savedV != null ? savedV : 1);
        setMuted(savedM);

        volume.addEventListener('input', (e)=>{
          setMuted(false);
          setVolume(e.target.value);
        });

        volume.addEventListener('change', () => volume.blur());
      }

      const SEEK_SMALL = 5, SEEK_BIG = 10
      function clamp(n, lo, hi){return Math.min(hi, Math.max(lo, n))}
      function seekBy(sec){
        if(!isFinite(audio.duration)) return;
        audio.currentTime = clamp((audio.currentTime||0)+sec, 0, audio.duration);
        if (audio.paused) { easeArmToDeg(progToDeg((audio.currentTime||0)/audio.duration), ARM_EASE_SEEK); ensureRAF(); }
      }

      function jumpToPercent(p){
        if(!isFinite(audio.duration)) return;
        audio.currentTime = audio.duration*clamp(p,0,1);
        if (audio.paused) { easeArmToDeg(progToDeg((audio.currentTime||0)/audio.duration), ARM_EASE_SEEK); ensureRAF(); }
      }

      document.addEventListener('keydown', e => {
        const el = e.target
        const tag = (el.tagName||'').toUpperCase()
        const type = (el.type||'').toLowerCase()
        const isTypingField =
          tag==='TEXTAREA' ||
          (tag==='INPUT' && /^(text|search|email|number|password|url|tel|date|time|datetime-local|month|week)$/i.test(type)) ||
          el.isContentEditable;
        if (isTypingField || e.altKey || e.ctrlKey || e.metaKey) return

        const s = e.shiftKey
        switch (e.code) {
          case 'KeyK': case 'Space': e.preventDefault(); playPause(); break
          case 'ArrowRight': e.preventDefault(); seekBy(s?SEEK_BIG:SEEK_SMALL); break
          case 'ArrowLeft':  e.preventDefault(); seekBy(s?-SEEK_BIG:-SEEK_SMALL); break
          case 'KeyL': seekBy(SEEK_BIG); break
          case 'KeyJ': seekBy(-SEEK_BIG); break
          case 'Period': next(); break;
          case 'Comma':  prev(); break;
          case 'ArrowUp':   e.preventDefault(); bumpVolume(e.shiftKey ? 0.1 : 0.05); break
          case 'ArrowDown': e.preventDefault(); bumpVolume(e.shiftKey ? -0.1 : -0.05); break
          case 'KeyM': audio.muted = !audio.muted; setMuted(audio.muted); break
          case 'KeyS':
            e.preventDefault();
            shuffle = !shuffle;
            shuffleBtn.setAttribute('aria-pressed', String(shuffle));
            shuffleBtn.textContent = shuffle ? 'shuffle (on)' : 'shuffle';
            if (shuffle) {
              shuffleOrder  = buildShuffleOrder(i);
              shuffleCursor = shuffleOrder.indexOf(i);
            } else {
              shuffleOrder  = null;
              shuffleCursor = 0;
            }
            renderPlaylist();
            break;
          case 'KeyR': cycleRepeat(); break
          case 'Home': e.preventDefault(); jumpToPercent(0); break
          case 'End':  e.preventDefault(); if (isFinite(audio.duration)) audio.currentTime = Math.max(0, audio.duration - .01); break
          case 'Digit0': case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
          case 'Digit5': case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9':
            jumpToPercent(Number(e.code.slice(-1)) / 10); break
        }
      })

      if('mediaSession'in navigator){
        const updateMeta=()=>{const t=tracks[i]||{};try{navigator.mediaSession.metadata=new MediaMetadata({title:t.title||'',artist:t.artist||'',album:"bevvy's vinyl",artwork:t.art?[{src:t.art,sizes:'512x512',type:'image/webp'}]:[]})}catch{}}
        const _loadMS=load;load=(idx,a=false)=>{_loadMS(idx,a);updateMeta();highlightPlaylist(idx)}
        navigator.mediaSession.setActionHandler('play',()=>{if(audio.paused)playPause()})
        navigator.mediaSession.setActionHandler('pause',()=>{if(!audio.paused)playPause()})
        navigator.mediaSession.setActionHandler('stop',()=>{if(!audio.paused)playPause()})
        navigator.mediaSession.setActionHandler('previoustrack',prev)
        navigator.mediaSession.setActionHandler('nexttrack',next)
        navigator.mediaSession.setActionHandler('seekbackward',d=>seekBy(-(d?.seekOffset||SEEK_SMALL)))
        navigator.mediaSession.setActionHandler('seekforward',d=>seekBy(d?.seekOffset||SEEK_SMALL))
        navigator.mediaSession.setActionHandler('seekto',d=>{if(d.fastSeek&&'fastSeek'in audio)audio.fastSeek(d.seekTime);else audio.currentTime=d.seekTime})
      }

      const aboutData = {
        text: "i bevvy, ergo, i am. welcome to my site! i'm from the USA, and i was raised on Homestuck and FNAF. i like computers, and i enjoy making user-friendly foss programs. sometimes i do art, but good luck finding it!<br>the music you see above is a selection of songs that are meaningful to me for one reason or another, and i hope you enjoy them.",
        tags: [
          "pronouns: any/it ⚣",
          "intp-5w4",
          "arch btw",
          "masto: @bevvy@trollian.space",
          "signal: bevvy.04",
          "github: calibancode"
        ]
      };

      const favImages = [
        { src: FAV("rat-pizza.gif"), alt: "an animated rat feeding you pizza" },
        { src: FAV("my-summer-car-120.webp"), full: FAV("my-summer-car.webp"), alt: "a gif from my summer car of the player drinking beer and throwing the bottle at teimo" },
        { src: FAV("sad-imp.webp"), alt: "a sad looking imp in a fashionable wizard hat from homestuck" },
        { src: FAV("nightmare-blunt-rotation.webp"), alt: "hideo kojima smoking a fat dart" },
        { src: FAV("shady-sam.webp"), alt: "shady sam from oblivion with a massive red arrow pointing at his face" },
        { src: FAV("gucci-store.webp"), alt: "bladee buyin the gucci store its like breaching air its nothing it means nothing" },
        { src: FAV("nikola-einstein.webp"), alt: "charicatures of nikola and einstein" },
        { src: FAV("stolas-warzone.jpg"), alt: "now that you're gone stolas in the style of a shellshocked soldier" },
        { src: FAV("furry-abuse.jpg"), alt: "a classic furry meme depicting domestic abuse" },
        { src: FAV("shrek-avatar.jpg"), alt: "an unholy abomination depicting shrek as a na'vi from james cameron's avatar" },
        { src: FAV("wizard.webp"), alt: "an extremely powerful wizard" },
        { src: FAV("crusher-unicycle.jpg"), alt: "dr beverly crusher riding a motorcycle behind the scenes of star trek tng" },
        { src: FAV("mugshot.webp"), alt: "a baby spotted hyena looking faintly ridiculous" },
        { src: FAV("mood.jpg"), alt: "mituna captor and cronus ampora having a moment" },
        { src: FAV("car.png"), alt: "car from garn47 with soulless, dead eyes" },
        { src: FAV("timon.webp"), alt: "timon from the lion king with an unimpressed expression" }
      ];

      function renderFavs(){
        const wrap = document.getElementById('fav-gallery');
        const sec  = document.getElementById('favorites');
        if (!wrap || !sec) return;

        // don’t mount twice
        if (renderFavs._mounted) return;

        // wait until the hero art has painted once, then allow the gallery to start
        const startAfterHero = () => {
          if (renderFavs._mounted) return;

          const mount = () => {
            if (renderFavs._mounted) return;
            renderFavs._mounted = true;

            wrap.innerHTML = '';
            let idx = 0;
            const batchSize = 6;

            function addBatch(){
              const end = Math.min(idx + batchSize, favImages.length);
              for (; idx < end; idx++) {
                const item = favImages[idx];

                let src  = item.src;
                let full = item.full ?? item.dataFull ?? item['data-full'] ?? null;
                let alt  = item.alt || '';

                if (altLayout) {
                  src  = FAV("scooter.webp");
                  full = FAV("scooter.webp");
                  alt  = "a scooter";
                }

                const img = document.createElement('img');
                img.loading = 'lazy';
                img.decoding = 'async';
                img.setAttribute('fetchpriority','low');
                img.src = src;
                img.alt = alt;

                const a = document.createElement('a');
                a.href = full || src;
                a.target = '_blank';
                a.rel = 'noopener';
                a.appendChild(img);

                wrap.appendChild(a);
              }

              if (idx < favImages.length) {
                (window.requestIdleCallback ? requestIdleCallback : (fn)=>setTimeout(fn,0))(addBatch, { timeout: 1500 });
              }
            }

            addBatch();
          };

          // if already visible, mount now; else wait until scrolled near
          const rect = sec.getBoundingClientRect();
          const inView = rect.top < (window.innerHeight || 0) && rect.bottom > 0;
          if (inView) {
            mount();
          } else {
            const io = new IntersectionObserver((entries) => {
              if (entries.some(e => e.isIntersecting)) {
                mount();
                io.disconnect();
              }
            }, { rootMargin: '200px' });
            io.observe(sec);
          }
        };

        if (art?.complete) {
          // image already loaded from cache/network
          startAfterHero();
        } else {
          art?.addEventListener?.('load', startAfterHero, { once: true });
        }
      }

      function renderPlaylist(){
        const wrap = document.getElementById('playlist-list');
        if(!wrap) return;
        wrap.innerHTML = '';

        const order = getVisibleOrder();

        order.forEach((trackIdx) => {
          const t = tracks[trackIdx];
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('data-idx', trackIdx);
          b.innerHTML = `<strong>${t.title}</strong><br><span class="artist">${t.artist}</span>`;
          if (trackIdx === i) b.setAttribute('aria-current','true');

          b.addEventListener('click', ()=>{
            autoAdvancing = false;
            const shouldAutoplay = autoAdvancing || !audio.paused;

            if (shuffle && shuffleOrder) {
              const pos = shuffleOrder.indexOf(trackIdx);
              if (pos !== -1) shuffleCursor = pos;
            }

            if (!shouldAutoplay) {
              easeArmToDeg(ARM_REST, ARM_EASE_FAST);
            }

            i = trackIdx;
            load(i, shouldAutoplay);
            renderPlaylist();
          });

          wrap.appendChild(b);
        });
      }

      function highlightPlaylist(idx){
        const wrap = document.getElementById('playlist-list');
        if(!wrap) return;
        [...wrap.querySelectorAll('button')].forEach(x=>x.removeAttribute('aria-current'));
        wrap.querySelector(`button[data-idx="${idx}"]`)?.setAttribute('aria-current','true');
      }

      function syncStageH(){
        const stage = document.querySelector('.stage');
        const deck  = document.querySelector('.deck');
        if(!stage || !deck) return;

        const h = Math.round(stage.getBoundingClientRect().height);
        deck.style.setProperty('--stageH', h + 'px');

        const sumPL = document.querySelector('#playlist summary');
        const list  = document.querySelector('#playlist .plist');
        if (list && sumPL) {
          const head = Math.round(sumPL.getBoundingClientRect().height);
          list.style.maxHeight = (h - head - 24) + 'px';
        }

        const sumN = document.querySelector('#notes summary');
        const pad  = document.getElementById('notepad');
        if (pad && sumN) {
          const headN = Math.round(sumN.getBoundingClientRect().height);
          pad.style.height = (h - headN - 24) + 'px';
        }
      }

      addEventListener('load', syncStageH);
      addEventListener('resize', syncStageH);
      document.getElementById('art')?.addEventListener('load', syncStageH);
      syncStageH();
      syncRepeatUI();

      const NOTES_KEY='vinyl_notes_v1';
      const noteEl=document.getElementById('notepad');
      if(noteEl){
        noteEl.value = localStorage.getItem(NOTES_KEY) || '';
        noteEl.addEventListener('input', ()=> localStorage.setItem(NOTES_KEY, noteEl.value));
      }

      document.getElementById('pld')?.addEventListener('toggle', syncStageH);
      document.getElementById('noted')?.addEventListener('toggle', syncStageH);

      if (matchMedia('(max-width:900px)').matches) {
        document.getElementById('pld')?.removeAttribute('open');
        document.getElementById('noted')?.removeAttribute('open');
      }

      (function enableArmDragIntegrated(){
        const svg   = document.querySelector('.tonearm');
        const arm   = document.getElementById('arm');
        const audio = document.getElementById('audio');
        const seek  = document.getElementById('seek');
        const tCur  = document.getElementById('tCur');
        const playBtn   = document.getElementById('play');
        const turntable = document.getElementById('turntable');

        if (!svg || !arm || !audio || !seek || !tCur) { addEventListener('load', enableArmDragIntegrated, { once:true }); return; }

        arm.style.pointerEvents = 'auto';
        arm.style.cursor = 'grab';
        arm.style.touchAction = 'none';

        const pivot = { x: 180, y: 20 };
        function clamp(n, lo, hi){ return Math.min(hi, Math.max(lo, n)); }
        function clientToSvg(el, cx, cy){
          const pt = el.createSVGPoint(); pt.x = cx; pt.y = cy;
          const m = el.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: cx, y: cy };
        }
        const wrap180 = a => ((a + 180) % 360 + 360) % 360 - 180;
        function angleFromPointerRaw(ev){
          const p = clientToSvg(svg, ev.clientX, ev.clientY);
          return Math.atan2(p.y - pivot.y, p.x - pivot.x) * 180 / Math.PI;
        }
        function normalize360(a){ return (a % 360 + 360) % 360; }
        function angleFromPointer(ev){
          const p = clientToSvg(svg, ev.clientX, ev.clientY);
          const raw = Math.atan2(p.y - pivot.y, p.x - pivot.x) * 180 / Math.PI;
          const armSpace = normalize360(raw - ARM_BASE_DEG);
          return clamp(armSpace, ARM_REST, ARM_MAX);
        }
        function degToProg(deg){
          return GEO.degToPGeom(deg);
        }
        function formatTimeLocal(sec){
          if (!isFinite(sec)) return '--:--';
          const m = Math.floor(sec/60), s = Math.floor(sec%60);
          return `${m}:${String(s).padStart(2,'0')}`;
        }

        let dragging = false;
        let wasPlaying = false;
        let dragAngle = 0;
        let lastRaw = 0;

        function syncByDeg(deg){
          armAnimating = false;
          armCurDeg    = deg;
          armTargetDeg = deg;
          arm.style.transform = `rotate(${ARM_BASE_DEG + deg}deg)`;

          if (isOnPlatterDeg(deg) && isFinite(audio.duration) && audio.duration > 0){
            const p = degToProg(deg);
            const t = audio.duration * p;
            seek.value = t;
            tCur.textContent = formatTimeLocal(t);
          }
        }

        function onPointerDown(ev){
          dragging = true;
          wasPlaying = !audio.paused;

          scrubbing    = true;
          seekDragging = true;

          if (wasPlaying) {
            autoAdvancing = true;
            turntable.classList.add('playing');
            audio.pause();
          } else {
            autoAdvancing = false;
            turntable.classList.remove('playing');
          }

          ensureRAF();

          arm.style.cursor = 'grabbing';
          arm.setPointerCapture?.(ev.pointerId);

          lastRaw   = angleFromPointerRaw(ev);
          dragAngle = armCurDeg;
          ev.preventDefault();
        }

        function onPointerMove(ev){
          if (!dragging) return;

          const raw = angleFromPointerRaw(ev);
          const d   = wrap180(raw - lastRaw);
          lastRaw   = raw;

          dragAngle = clamp(dragAngle + d, ARM_REST, ARM_MAX);
          syncByDeg(dragAngle);

          ev.preventDefault();
        }

        function onPointerUp(ev){
          if (!dragging) return;
          dragging = false;

          const onPlatter = isOnPlatterDeg(dragAngle);
          const hasMeta   = isFinite(audio.duration) && audio.duration > 0;

          if (onPlatter){
            const p = degToProg(dragAngle);
            if (hasMeta){
              const t = Math.min(audio.duration - 0.01, audio.duration * p);
              audio.currentTime = t; seek.value = t; tCur.textContent = formatTime(t);
              prePlaySeekP = null;
            } else {
              prePlaySeekP = p;
            }
          } else {
            prePlaySeekP = null;
            if (hasMeta){ audio.currentTime = 0; seek.value = 0; tCur.textContent = '0:00'; }
          }

          seekDragging = false;
          scrubbing    = false;

          if (wasPlaying){
            autoAdvancing = false;
            audio.play().then(()=>{
              startSpin();
              playBtn.textContent = '❚❚ pause';
              const d = audio.duration;
              if (isFinite(d) && d > 0){
                easeArmToDeg(progToDeg((audio.currentTime||0)/d), ARM_EASE_FAST);
              }
            }).catch(()=>{});
          } else {
            autoAdvancing = false;
            turntable.classList.remove('playing');
            easeArmToDeg(dragAngle, ARM_EASE_FAST);
          }

          arm.style.cursor = 'grab';
          arm.releasePointerCapture?.(ev.pointerId);
          ev.preventDefault();
        }

        arm.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup',   onPointerUp,   { passive: false });
        window.addEventListener('pointercancel', onPointerUp, { passive: false });
        arm.addEventListener('lostpointercapture', onPointerUp);

        window.addEventListener('blur', () => { if (dragging) onPointerUp(new Event('pointercancel')); });
        document.addEventListener('visibilitychange', () => {
          if (document.hidden && dragging) onPointerUp(new Event('pointercancel'));
        });
      })();

      (()=>{let p=0,m=Array.from(atob('Nzc5OTQ2NDZTUA=='),c=>c.charCodeAt(0)^17);addEventListener('keydown',e=>{p=e.keyCode===m[p]?p+1:0;if(p===m.length){p=0;altLayout=true;alert('scooter mode enabled!');swapArt(tracks[i].art);delete renderFavs._mounted;document.getElementById('fav-gallery').innerHTML='';renderFavs();}});})();

      (function mountReducedMotionOverride(){
        if (!reducesMotion()) return;

        const row = document.querySelector('.buttons-row');
        if (!row) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id   = 'rm-override';
        btn.textContent = 'enable animations';
        btn.title = 'Override “Reduce Motion” for this session';
        row.appendChild(btn);

        btn.addEventListener('click', () => {
          sessionStorage.setItem(RM_OVERRIDE_KEY, 'force-off');

          ensureRAF();
          if (!audio.paused) {
            spinVel = currentDegPerSec();
            turntable.classList.add('playing');
          }
          btn.remove();
        });
      })();

      renderFavs();
      buildSlugIndex();
      setArmImmediateDeg(ARM_REST);
      renderPlaylist();
      highlightPlaylist(i);
      setPreservePitch(false);

      if (tracks.length) {
        if (!consumeTrackParam()) {
          const restored = tryRestorePlaybackState?.();
          if (!restored) load(0, false);
        }
  } else {
    meta.textContent = 'drop some tracks into the tracks[] array.';
  }
})();
