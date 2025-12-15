import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const canvas = document.getElementById("c");
const dropzone = document.getElementById("dropzone");
const dropOverlay = document.getElementById("dropOverlay");

const fileInput = document.getElementById("fileInput");
const resetBtn = document.getElementById("resetBtn");
const clearBtn = document.getElementById("clearBtn");

const gridToggle = document.getElementById("gridToggle");
const axesToggle = document.getElementById("axesToggle");
const autoRotateToggle = document.getElementById("autoRotateToggle");

const lightIntensity = document.getElementById("lightIntensity");
const lightIntensityVal = document.getElementById("lightIntensityVal");
const sunAngle = document.getElementById("sunAngle");
const sunAngleVal = document.getElementById("sunAngleVal");

const modelList = document.getElementById("modelList");
const statusEl = document.getElementById("status");

function setStatus(txt) {
  statusEl.textContent = txt ? `• ${txt}` : "";
}

// Renderer / Scene / Camera
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Un rendu plus “clair” (tone mapping + exposure)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
// Fond plus lumineux
scene.background = new THREE.Color(0x1b2742);

const camera = new THREE.PerspectiveCamera(50, 2, 0.01, 5000);
camera.position.set(6, 5, 8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1, 0);

// ----------------------
// Lumières (pilotées par slider)
// ----------------------
const hemi = new THREE.HemisphereLight(0xffffff, 0x2a3a55, 1.0);
scene.add(hemi);

// Petit fill directionnel (sans ombres)
const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(10, 12, 10);
fill.castShadow = false;
scene.add(fill);

// “Soleil” directionnel (avec ombres) : position pilotée par un slider
const sun = new THREE.DirectionalLight(0xffffff, 1.15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

sun.target.position.set(0, 0, 0);
scene.add(sun.target);

// Zone d’ombre adaptée à une emprise ~80x80m (2× 40x40) avec marge
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 140;
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;

// ----------------------
// Helpers
// ----------------------
const grid = new THREE.GridHelper(100, 100); // 2× plus grand
grid.material.opacity = 0.25;
grid.material.transparent = true;
grid.visible = false;
scene.add(grid);

const axes = new THREE.AxesHelper(2);
axes.visible = false;
scene.add(axes);

// ----------------------
// Sol “herbe” (procédural) + reçoit les ombres
// (2× plus grand : ~100x100m)
// ----------------------
function createGrassTexture(size = 256) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");

  ctx.fillStyle = "#2f6b2f";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 2.0 + 0.5;
    const g = 110 + Math.floor(Math.random() * 80);
    const rr = 30 + Math.floor(Math.random() * 30);
    const bb = 25 + Math.floor(Math.random() * 30);
    ctx.fillStyle = `rgba(${rr},${g},${bb},0.25)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 1000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 3 + Math.random() * 10;
    const ang = Math.random() * Math.PI * 2;
    ctx.strokeStyle = Math.random() > 0.5 ? "#a7d36b" : "#3c8a3c";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;

  // Sur une surface plus grande, on répète plus pour éviter une herbe “géante”
  tex.repeat.set(8, 8);

  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

const grassTex = createGrassTexture(256);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({
    map: grassTex,
    roughness: 1.0,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

// ----------------------
// Loader + state
// ----------------------
const loader = new GLTFLoader();

let loadedModels = []; // { name, root, box }
let defaultCameraState = null;

function setModelListUI() {
  modelList.innerHTML = "";
  for (const m of loadedModels) {
    const li = document.createElement("li");
    li.textContent = m.name;
    modelList.appendChild(li);
  }
}

function traverseForShadows(obj) {
  obj.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = true;
      if (n.material) n.material.side = THREE.DoubleSide;
    }
  });
}

// Masque un sol importé dans le GLB (cause classique de z-fighting)
function hideLikelyGroundMeshes(root) {
  root.updateMatrixWorld(true);

  root.traverse((n) => {
    if (!n.isMesh) return;

    const box = new THREE.Box3().setFromObject(n);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const isFlat = size.y < 0.15;
    const isLarge = size.x > 25 && size.z > 25;
    const nearZero = Math.abs(center.y) < 1.0;

    if (isFlat && isLarge && nearZero) {
      n.visible = false;
      n.castShadow = false;
      n.receiveShadow = false;
    }
  });
}

function computeBox(root) {
  return new THREE.Box3().setFromObject(root);
}

function fitCameraToBox(box, { padding = 1.25 } = {}) {
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = (maxDim / (2 * Math.tan(fov / 2))) * padding;

  const v = new THREE.Vector3(1, 0.8, 1).normalize();
  camera.position.copy(center.clone().add(v.multiplyScalar(dist)));

  camera.near = Math.max(0.01, dist / 100);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();

  if (!defaultCameraState) {
    defaultCameraState = {
      position: camera.position.clone(),
      target: controls.target.clone(),
      near: camera.near,
      far: camera.far
    };
  }
}

function arrangeModelsRow() {
  if (loadedModels.length === 0) return;

  let cursorX = 0;
  const gap = 1.0;

  for (const m of loadedModels) {
    const box = computeBox(m.root);
    const size = new THREE.Vector3();
    box.getSize(size);

    const center = new THREE.Vector3();
    box.getCenter(center);
    m.root.position.sub(center);

    // Pose au sol
    const boxAfterCenter = computeBox(m.root);
    m.root.position.y -= boxAfterCenter.min.y;

    m.root.position.x += cursorX + size.x / 2;
    cursorX += size.x + gap;

    m.box = computeBox(m.root);
  }

  const globalBox = new THREE.Box3();
  for (const m of loadedModels) globalBox.union(m.box);

  fitCameraToBox(globalBox, { padding: 1.35 });
}

function addModelRoot(name, root) {
  traverseForShadows(root);
  hideLikelyGroundMeshes(root);
  scene.add(root);

  loadedModels.push({ name, root, box: computeBox(root) });
  setModelListUI();
  arrangeModelsRow();
}

function addModelFromArrayBuffer(name, arrayBuffer) {
  return new Promise((resolve, reject) => {
    loader.parse(
      arrayBuffer,
      "",
      (gltf) => {
        const root = gltf.scene || gltf.scenes?.[0];
        if (!root) return reject(new Error("GLB invalide (pas de scène)."));
        addModelRoot(name, root);
        resolve();
      },
      (err) => reject(err)
    );
  });
}

function addModelFromURL(name, url) {
  return new Promise((resolve, reject) => {
    const safeUrl = encodeURI(url);

    setStatus(`Chargement : ${name}…`);
    loader.load(
      safeUrl,
      (gltf) => {
        const root = gltf.scene || gltf.scenes?.[0];
        if (!root) return reject(new Error("GLB invalide (pas de scène)."));
        addModelRoot(name, root);
        setStatus("");
        resolve();
      },
      (ev) => {
        if (ev.total) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          setStatus(`Chargement : ${name}… ${pct}%`);
        }
      },
      (err) => {
        console.error(err);
        setStatus(`Erreur de chargement : ${name}`);
        reject(err);
      }
    );
  });
}

async function handleFiles(fileList) {
  const files = Array.from(fileList)
    .filter(f => /\.(glb|gltf)$/i.test(f.name))
    .slice(0, 30);

  for (const f of files) {
    setStatus(`Import local : ${f.name}…`);
    const buf = await f.arrayBuffer();
    await addModelFromArrayBuffer(f.name, buf);
    setStatus("");
  }
}

function disposeModel(root) {
  root.traverse((n) => {
    if (n.isMesh) {
      n.geometry?.dispose?.();
      if (n.material) {
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        for (const mat of mats) {
          for (const k of Object.keys(mat)) {
            const v = mat[k];
            if (v && v.isTexture) v.dispose?.();
          }
          mat.dispose?.();
        }
      }
    }
  });
}

function clearSceneModels() {
  for (const m of loadedModels) {
    scene.remove(m.root);
    disposeModel(m.root);
  }
  loadedModels = [];
  defaultCameraState = null;
  setModelListUI();
  setStatus("");
}

function resetView() {
  if (!defaultCameraState) return;
  camera.position.copy(defaultCameraState.position);
  camera.near = defaultCameraState.near;
  camera.far = defaultCameraState.far;
  camera.updateProjectionMatrix();

  controls.target.copy(defaultCameraState.target);
  controls.update();
}

function resizeRendererToDisplaySize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pr = renderer.getPixelRatio();

  const needResize =
    canvas.width !== Math.floor(width * pr) ||
    canvas.height !== Math.floor(height * pr);

  if (needResize) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

// ----------------------
// Sliders : intensité + position soleil
// ----------------------
const base = {
  hemi: 1.15,
  fill: 0.65,
  sun: 1.25
};

// Soleil : cercle autour du centre, hauteur fixe (votre scène : 4–6 m haut)
const sunParams = {
  radius: 60,   // adapté à ~80x80m
  height: 30    // au-dessus des tables (4–6m), pour une lecture d’ombres propre
};

function updateLightingFromUI() {
  const intensity = parseFloat(lightIntensity.value);
  lightIntensityVal.textContent = intensity.toFixed(2);

  const angDeg = parseInt(sunAngle.value, 10);
  sunAngleVal.textContent = `${angDeg}°`;

  // Intensités
  hemi.intensity = base.hemi * intensity;
  fill.intensity = base.fill * intensity;
  sun.intensity = base.sun * intensity;

  // Position du soleil (azimuth)
  const a = THREE.MathUtils.degToRad(angDeg);
  const x = Math.cos(a) * sunParams.radius;
  const z = Math.sin(a) * sunParams.radius;

  sun.position.set(x, sunParams.height, z);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();

  // Demande un refresh des ombres
  sun.shadow.needsUpdate = true;
}

lightIntensity.addEventListener("input", updateLightingFromUI);
sunAngle.addEventListener("input", updateLightingFromUI);

// Init sliders -> applique valeurs par défaut
updateLightingFromUI();

// ----------------------
// Animate
// ----------------------
function animate() {
  resizeRendererToDisplaySize();

  controls.autoRotate = autoRotateToggle.checked;
  controls.autoRotateSpeed = 0.18; // lent

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// UI
fileInput.addEventListener("change", async (e) => {
  if (e.target.files?.length) await handleFiles(e.target.files);
  e.target.value = "";
});

resetBtn.addEventListener("click", resetView);
clearBtn.addEventListener("click", clearSceneModels);

gridToggle.addEventListener("change", () => (grid.visible = gridToggle.checked));
axesToggle.addEventListener("change", () => (axes.visible = axesToggle.checked));

// Drag & drop
function showDrop(active) {
  dropOverlay.classList.toggle("active", active);
}
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); showDrop(true); });
dropzone.addEventListener("dragleave", () => showDrop(false));
dropzone.addEventListener("drop", async (e) => {
  e.preventDefault();
  showDrop(false);
  if (e.dataTransfer?.files?.length) await handleFiles(e.dataTransfer.files);
});

// Boot: charge automatiquement les modèles déclarés dans models/manifest.json
async function loadModelsFromManifest() {
  try {
    const res = await fetch("./models/manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`manifest.json introuvable (${res.status})`);
    const data = await res.json();

    const models = Array.isArray(data.models) ? data.models : [];
    if (models.length === 0) throw new Error("manifest.json ne contient aucun modèle.");

    for (const file of models) {
      await addModelFromURL(file, `./models/${file}`);
    }
  } catch (err) {
    console.error(err);
    setStatus("Manifest absent/invalide. Vérifiez models/manifest.json et le nom du .glb.");
  }
}

loadModelsFromManifest();
