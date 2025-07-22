const map = L.map('map').setView([56.36, 41.32], 13);
let selectedBaseType = null;
const userQuery = window.adminUserId ? '?id=' + window.adminUserId : '';

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  errorTileUrl: ''
}).addTo(map);


let bases = [];
let callIcons = {};
let addingBaseMode = false;
let movingBaseId = null;
let openBaseId = null;
let balance = 0;
let rating = 100;
let ratingHistory = [];
let balanceHistory = [];
let isGeneratingCall = false;
const dispatcherIntervals = {};
let addModeCircles = [];
const zoneEdit = { baseId: null, points: [], poly: null, markers: [] };
let skipUnloadSave = false;
const CART_STORAGE_KEY = 'cart';
let cart = [];
let socket = null;

function loadCartFromStorage() {
  try {
    const data = localStorage.getItem(CART_STORAGE_KEY);
    cart = data ? JSON.parse(data) : [];
  } catch {
    cart = [];
  }
}

function saveCartToStorage() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {}
}

function cleanCart() {
  const valid = [];
  for (const item of cart) {
    const base = bases.find(b => b.id === item.baseId);
    if (!base) continue;
    const opt = (vehicleOptions[base.type] || []).find(o => o.type === item.type);
    if (opt) valid.push(item);
  }
  if (valid.length !== cart.length) {
    cart = valid;
    saveCartToStorage();
  }
}
let actionLock = false;

const vehicleCategory = {
  ambulance: 'medical',
  rescue_ambulance: 'medical',
  psp: 'medical',
  msp: 'medical',
  fire_truck: 'fire',
  ladder_truck: 'fire',
  tanker_truck: 'fire',
  aerial_platform: 'fire',
  special_fire: 'fire',
  foam_truck: 'fire',
  patrol: 'police',
  swat_van: 'police',
  dps_car: 'police',
  k9_unit: 'police'
};

function sortVehicleTypes(types = []) {
  const order = { fire: 0, police: 1, medical: 2, other: 3 };
  return types.slice().sort((a, b) => {
    const ca = vehicleCategory[a] || 'other';
    const cb = vehicleCategory[b] || 'other';
    if (ca !== cb) return order[ca] - order[cb];
    return 0;
  });
}

const progressRates = { medical: 0.5, fire: 0.4, police: 0.3 };

function setSkipUnload() {
  skipUnloadSave = true;
}

function getStatusText(status, vehicleType = '') {
  switch (status) {
    case 'idle':
      return 'Свободна';
    case 'enroute':
      return 'Едет на вызов';
    case 'onscene':
      return 'Работает на вызове';
    case 'transport':
      if (['ambulance','rescue_ambulance','psp','msp'].includes(vehicleType)) return 'Перевозит пациента';
      if (['patrol','swat_van','dps_car','k9_unit'].includes(vehicleType)) return 'Перевозит преступника';
      return 'Перевозит пациента/преступника';
    case 'return':
      return 'Возвращается';
    case 'waiting_tow':
      return 'Ждёт эвакуатор';
    default:
      return status;
  }
}

function setZoneEditOpacity(enabled, excludeId = null) {
  const op = enabled ? 0.3 : 1;
  bases.forEach(b => {
    if (b.marker) b.marker.setOpacity(enabled && b.id !== excludeId ? op : 1);
    b.vehicles.forEach(v => {
      if (v.marker) v.marker.setOpacity(enabled ? op : 1);
      if (v.polyline) v.polyline.setStyle({ opacity: enabled ? op : 1 });
    });
  });
  callMarkers.forEach(c => {
    if (c.marker) c.marker.setOpacity(enabled ? op : 1);
  });
}

function showZoneEditMenu() {
  const m = document.getElementById('zone-edit-menu');
  if (m) m.style.display = 'block';
}

function hideZoneEditMenu() {
  const m = document.getElementById('zone-edit-menu');
  if (m) m.style.display = 'none';
}

function clearZonePoints() {
  if (!zoneEdit.baseId) return;
  zoneEdit.points = [];
  drawZoneEdit();
}


function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

const saveBasesThrottled = throttle(() => saveBases(true), 1000);
const saveCallsThrottled = throttle(saveCalls, 1000);

function snapshotVehiclesState() {
  bases.forEach(base => {
    base.vehicles.forEach(v => {
      if (v.marker) {
        const pos = v.marker.getLatLng();
        v.lat = pos.lat;
        v.lng = pos.lng;
      }
      // Не изменяем v.route здесь, чтобы сохранить исходный полный маршрут.
      // Координаты полилинии отображают только оставшийся путь и не должны
      // перезаписывать полный маршрут, иначе прогресс будет смещаться при
      // перезагрузке страницы.
    });
  });
}

function buildGameData() {
  snapshotVehiclesState();
  return {
    balance,
    rating,
    bases: bases.map(base => ({
      id: base.id,
      name: base.name,
      lat: base.lat,
      lng: base.lng,
      type: base.type,
      level: base.level,
      active: base.active,
      locked: !!base.locked,
      radius: base.radius,
      callInterval: base.callInterval,
      zone: base.zone,
      vehicles: base.vehicles.map(sanitizeVehicle),
      personnel: base.personnel,
      upgrades: base.upgrades,
      missions: base.missions,
      serviceStation: sanitizeServiceStation(base.serviceStation)
    })),
    calls: callMarkers.map(call => ({
      id: call.id,
      type: call.type,
      lat: call.lat,
      lng: call.lng,
      emoji: call.emoji,
      text: call.text,
      address: call.address,
      timestamp: call.timestamp,
      fake: call.fake ? 1 : 0,
      penalized: call.penalized ? 1 : 0,
      penalty: call.penalty || 0,
      assigned: call.assigned ? 1 : 0,
      assignedVehicles: call.assignedVehicles || [],
      requiredVehicles: sortVehicleTypes(call.requiredVehicles || []),
      progress: call.progress || 0,
      preProgress: call.preProgress || 0,
      duration: call.duration || 60,
      workTime: call.workTime || 0,
      dispatcherId: call.dispatcherId || null
    }))
  };
}

let saveQueue = Promise.resolve();
async function saveGameData() {
  const data = buildGameData();
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => fetch('game_data.php' + userQuery, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }));
  try {
    await saveQueue;
  } catch (e) {
    console.error('Ошибка сохранения данных:', e);
  }
}

function saveGameDataSync() {
  const data = buildGameData();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  try {
    navigator.sendBeacon('game_data.php' + userQuery, blob);
  } catch {}
}

async function flushPendingSave() {
  const stored = localStorage.getItem('pendingGameData');
  if (!stored) return;
  localStorage.removeItem('pendingGameData');
  // Отложенное сохранение отключено, чтобы не перезаписывать
  // данные, изменённые напрямую в базе данных
}

async function loadGameData() {
  try {
    const res = await fetch('game_data.php' + userQuery);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const offlineMs = data.last_online ? Date.now() - new Date(data.last_online).getTime() : 0;
    const offlineThreshold = 15000; // ignore short gaps like page reload
    balance = Number(data.balance) || 10000;
    rating = data.rating || 100;
    ratingHistory = [];
    balanceHistory = [];
    try {
      const hres = await fetch('history.php' + userQuery);
      if (hres.ok) {
        const hdata = await hres.json();
        ratingHistory = (hdata.rating_history || []).map(r => ({
          time: r.time,
          change: r.change_amount,
          reason: r.reason
        }));
        balanceHistory = (hdata.balance_history || []).map(b => ({
          time: b.time,
          change: b.change_amount,
          reason: b.reason
        }));
      }
    } catch {}
    bases = [];
    const dispatchersToStart = [];
    callMarkers.forEach(c => { if (c.marker) map.removeLayer(c.marker); });
    callMarkers.length = 0;
    (data.bases || []).forEach(base => {
      const icon = icons[base.type] || icons["Полицейский участок"];
      const marker = L.marker([base.lat, base.lng], { icon })
        .addTo(map)
        .on("click", () => openBasePanel(base.id));
      const vehicles = (base.vehicles || []).map(v => ({
        ...v,
        mileage: v.mileage || 0,
        routeProgress: v.routeProgress || 0,
        condition: Math.round(v.condition || 100),
        route: Array.isArray(v.route) ? v.route : null,
        marker: null,
        polyline: null,
        moveTimer: null
        
      }));
      const bObj = {
        ...base,
        marker,
        level: base.level || 1,
        active: base.hasOwnProperty('active') ? base.active : true,
        locked: base.hasOwnProperty('locked') ? base.locked : false,
        vehicles,
        personnel: base.personnel || [],
        upgrades: base.upgrades || [],
        missions: base.missions || [],
        serviceStation: base.serviceStation ? {
          level: base.serviceStation.level || 1,
          master: base.serviceStation.master || null,
          towTruck: !!base.serviceStation.towTruck,
          mechanic: base.serviceStation.mechanic ? {
            lat: base.serviceStation.mechanic.lat || base.lat,
            lng: base.serviceStation.mechanic.lng || base.lng,
            status: base.serviceStation.mechanic.status || 'idle',
            route: Array.isArray(base.serviceStation.mechanic.route) ? base.serviceStation.mechanic.route : null,
            marker: null,
            polyline: null,
            moveTimer: null
          } : null,
          upgrading: false,
          hiring: !!base.serviceStation.hiring
        } : null,
        radius: base.radius || (base.type === 'Диспетчерский пункт' ? 1000 : 0),
        callInterval: base.callInterval || 60000,
        zone: base.zone || null,
        callCircle: null
      };
      bases.push(bObj);
      attachBaseHoverEvents(bObj);
      if (bObj.type === 'Диспетчерский пункт' && bObj.active) dispatchersToStart.push(bObj);
    });
    (data.calls || []).forEach(call => {
      const marker = L.marker([call.lat, call.lng], {
        icon: L.divIcon({
          className: 'call-marker',
          html: `<div style="font-size: 20px;">${call.emoji}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      }).addTo(map).bindPopup(`<strong>Вызов:</strong> ${call.text}<br><strong>Адрес:</strong> ${call.address}`);
      marker.on('click', () => openCallMenu(call.id));
      marker.on('mouseover', () => marker.openPopup());
      marker.on('mouseout', () => marker.closePopup());
      const duration = (call.duration || (callIcons[call.type] && callIcons[call.type].duration) || 60);
      const workTime = call.workTime || 0;
      const progress = call.progress || 0;
      const preProgress = call.preProgress || 0;
      callMarkers.push({
        ...call,
        marker,
        fake: !!call.fake,
        timestamp: call.timestamp || Date.now(),
        dispatcherId: call.dispatcherId || null,
        penalized: !!call.penalized,
        penalty: call.penalty || 0,
        assigned: !!call.assigned,
        assignedVehicles: Array.isArray(call.assignedVehicles) ? call.assignedVehicles : [],
        requiredVehicles: Array.isArray(call.requiredVehicles) ? sortVehicleTypes(call.requiredVehicles) : [],
        duration,
        workTime,
        lastUpdate: Date.now(),
        progress,
        preProgress
      });
    });
    if (offlineMs > offlineThreshold) {
      applyOfflineProgress(offlineMs);
      await saveGameData();
    }
    dispatchersToStart.forEach(b => startDispatcher(b));
  } catch (e) {
    console.error('Ошибка загрузки данных:', e);
  }
  updateBalanceUI();
  updateRatingUI();
  updateCallListUI();
  renderBases();
  updateBaseLocks();
  renderVehicles();
}


async function loadCallTypes() {
  try {
    const response = await fetch('calls.json');
    callIcons = await response.json();
    populateCallTypeSelect();
  } catch (e) {
    console.error("Ошибка загрузки calls.json:", e);
    callIcons = {}; // fallback
    populateCallTypeSelect();
  }
}

function populateCallTypeSelect() {
  const select = document.getElementById('call-type-select');
  if (!select) return;
  select.innerHTML = '<option value="">Случайный вызов</option>';
  Object.entries(callIcons).forEach(([key, info]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = info.text;
    select.appendChild(opt);
  });
}

function getReadNewsIds() {
  try {
    const data = localStorage.getItem('readNews');
    return Array.isArray(JSON.parse(data)) ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveReadNewsIds(ids) {
  try {
    localStorage.setItem('readNews', JSON.stringify(ids.slice(-100)));
  } catch {}
}

function markNewsAsRead(id) {
  if (!id) return;
  const ids = getReadNewsIds();
  if (!ids.includes(id)) {
    ids.push(id);
    saveReadNewsIds(ids);
  }
}

function markAllNewsRead() {
  const items = document.querySelectorAll('#news-content .news-item');
  items.forEach(it => {
    it.classList.remove('unread');
    const id = it.dataset.id;
    if (id) {
      markNewsAsRead(id);
    }
  });
}

async function loadNews() {
  try {
    const response = await fetch("news.json?" + Date.now(), {cache: 'no-cache'});
    if (!response.ok) throw new Error("HTTP " + response.status);
    const items = await response.json();
    const container = document.getElementById("news-content");
    if (Array.isArray(items)) {
      items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }
    if (container) {
      const readIds = getReadNewsIds();
      container.innerHTML = "";
      items.forEach(item => {
        if (typeof item === 'string') {
          const p = document.createElement('p');
          p.textContent = item;
          container.appendChild(p);
          return;
        }
        const wrapper = document.createElement('div');
        wrapper.className = 'news-item';
        wrapper.dataset.id = item.id || '';
        if (item.id && !readIds.includes(item.id)) {
          wrapper.classList.add('unread');
        }
        const mark = document.createElement('span');
        mark.className = 'mark-read';
        mark.textContent = '✔';
        mark.title = 'Прочитано';
        mark.addEventListener('click', e => {
          e.stopPropagation();
          wrapper.classList.remove('unread');
          markNewsAsRead(item.id);
        });
        wrapper.addEventListener('click', () => {
          wrapper.classList.remove('unread');
          markNewsAsRead(item.id);
        });
        if (item.time) {
          const tp = document.createElement('p');
          tp.textContent = item.time;
          tp.className = 'news-time';
          wrapper.appendChild(tp);
        }
        if (Array.isArray(item.items)) {
          const ul = document.createElement('ul');
          item.items.forEach(t => {
            const li = document.createElement('li');
            li.textContent = t;
            ul.appendChild(li);
          });
          wrapper.appendChild(ul);
        } else if (item.text) {
          const p = document.createElement('p');
          p.textContent = item.text;
          wrapper.appendChild(p);
        }
        wrapper.appendChild(mark);
        container.appendChild(wrapper);
      });
    }
  } catch (e) {
    console.error("Ошибка загрузки новостей:", e);
  }
}

// ID базы
function generateBaseID() {

  return 'base-' + Math.random().toString(36).substr(2, 9);
}

const STO_COST = 1500;
const MAX_STO_LEVEL = 5;
const TOW_TRUCK_COST = 2000;
const ONSITE_REPAIR_BASE = 300;
const ONSITE_REPAIR_PER_KM = 10;
const MASTER_OPTIONS = [
  { id: 'basic', name: 'Пётр', skill: 1, hireCost: 500, salary: 100 },
  { id: 'advanced', name: 'Сергей', skill: 2, hireCost: 800, salary: 150 },
  { id: 'expert', name: 'Иван', skill: 3, hireCost: 1200, salary: 200 }
];

function createMechanic(base) {
  return {
    lat: base.lat,
    lng: base.lng,
    status: 'idle',
    speed: 40,
    marker: null,
    polyline: null,
    route: null,
    moveTimer: null
  };
}

function moveMechanic(base, mechanic, targetVehicle, route) {
  const img = getMechanicImage();
  if (mechanic.marker) try { map.removeLayer(mechanic.marker); } catch {}
  if (mechanic.polyline) try { map.removeLayer(mechanic.polyline); } catch {}
  mechanic.marker = L.marker([base.lat, base.lng], {
    icon: L.divIcon({ className: 'vehicle-marker', html: `<img src="${img}" alt="">`, iconSize: [64,64], iconAnchor: [32,32] })
  }).addTo(map);
  mechanic.polyline = L.polyline(route, { color: 'orange' }).addTo(map);
  animateRoute(mechanic, route, async () => {
    mechanic.status = 'onscene';
    refreshBasePanel(base.id);
    setTimeout(async () => {
      targetVehicle.condition = 100;
      if (targetVehicle.status === 'waiting_tow') {
        targetVehicle.status = 'idle';
      }
      saveBases(true);
      refreshBasePanel(base.id);
      showStatus(`🛠 Машина ${targetVehicle.name} отремонтирована`);
      const backRoute = await getRoute({lat: mechanic.lat, lng: mechanic.lng}, {lat: base.lat, lng: base.lng});
      const smooth = densifyRoute(backRoute);
      returnMechanic(base, mechanic, smooth);
    }, 5000);
  });
}

function returnMechanic(base, mechanic, route) {
  if (mechanic.polyline) try { map.removeLayer(mechanic.polyline); } catch {}
  mechanic.polyline = L.polyline(route, { color: 'orange' }).addTo(map);
  mechanic.status = 'return';
  animateRoute(mechanic, route, () => {
    if (mechanic.marker) try { map.removeLayer(mechanic.marker); } catch {}
    if (mechanic.polyline) try { map.removeLayer(mechanic.polyline); } catch {}
    mechanic.marker = null;
    mechanic.polyline = null;
    mechanic.status = 'idle';
    mechanic.lat = base.lat;
    mechanic.lng = base.lng;
    saveBases(true);
    refreshBasePanel(base.id);
  });
}


function getServiceCost(base) {
  const level = (base.serviceStation && base.serviceStation.level) || 1;
  const skill = (base.serviceStation && base.serviceStation.master && base.serviceStation.master.skill) || 1;
  if (!base.serviceStation || !base.serviceStation.master) return 0;
  const discount = (level - 1) * 0.1 + (skill - 1) * 0.05;
  const cost = Math.round(200 * (1 - discount));
  return cost < 50 ? 50 : cost;
}

function formatElapsedTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

function getRemainingTime(call) {
  const baseProgress = typeof call.preProgress === 'number'
    ? call.preProgress
    : (call.progress || 0);
  const durationMs = (call.duration || 60) * 1000;
  const remaining = (1 - baseProgress / 100) * durationMs - (call.workTime || 0);
  return remaining > 0 ? remaining : 0;
}

// Цветные иконки для разных типов баз
const icons = {
  "Полицейский участок": new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/9830/9830833.png',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  }),
  "Больница": new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/15406/15406239.png',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  }),
  "Пожарная часть": new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/11210/11210082.png',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  }),
  "Диспетчерский пункт": new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/1789/1789302.png',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  })
};

const baseTypeNames = {
  "Полицейский участок": "Полицейский участок",
  "Больница": "Больница",
  "Пожарная часть": "Пожарная часть",
  "Диспетчерский пункт": "Диспетчерский пункт"
};

const baseCosts = {
  "Полицейский участок": 1000,
  "Больница": 1500,
  "Пожарная часть": 2000,
  "Диспетчерский пункт": 2500
};

const defaultBaseNamePrefixes = {
  "Полицейский участок": "Полицейский участок",
  "Больница": "Больница",
  "Пожарная часть": "Пожарная часть",
  "Диспетчерский пункт": "Связь"
};

// Background images for vehicle shops. Add your own images in the paths below.
// Example: place an image for the police shop at "cars/police_shop.png" and it
// will be used automatically.
const shopBackgroundImages = {
  "Полицейский участок": "cars/police_shop.png",
  "Больница": "cars/hospital_shop.png",
  "Пожарная часть": "cars/fire_shop.png",
  "Диспетчерский пункт": "cars/dispatcher_shop.png",
  "default": ""
};

window.vehicleModalBaseType = null;

function getDefaultBaseName(type) {
  const prefix = defaultBaseNamePrefixes[type] || 'Здание';
  const numbers = bases
    .filter(b => b.type === type && b.name.startsWith(prefix))
    .map(b => parseInt(b.name.replace(prefix + ' #', ''), 10))
    .filter(n => !isNaN(n));
  const next = numbers.length ? Math.max(...numbers) + 1 : 1;
  return `${prefix} #${next}`;
}

const vehicleOptions = {
  "Полицейский участок": [
    {
      type: "patrol",
      name: "ППС",
      cost: 500,
      speed: 60,
      emoji: "🚓",
      img: "cars/ППС.png",
      role: "Патрульно-Постовая Служба – основная машина патрульной службы.",
      callType: "кражи, драки, бытовые конфликты."
    },
    {
      type: "dps_car",
      name: "ДПС",
      cost: 550,
      speed: 60,
      emoji: "🚔",
      img: "cars/ДПС.png",
      role: "Дорожно-Патрульная Служба - отвечает за дорожные происшествия, регулировку движения.",
      callType: "ДТП, проверка транспорта."
    },
    {
      type: "swat_van",
      name: "Спецназ",
      cost: 800,
      speed: 55,
      emoji: "🚐",
      img: "cars/Спецназ.png",
      role: "Участвует в штурмах, задержаниях вооружённых преступников.",
      callType: "теракты, вооружённые захваты."
    },
    {
      type: "k9_unit",
      name: "Кинолог",
      cost: 600,
      speed: 55,
      emoji: "🐕",
      img: "cars/Кинолог.png",
      role: "Машина с собакой, используется для поиска людей, взрывчатки, наркотиков.",
      callType: "розыск, проверки зданий."
    }
  ],
  "Больница": [
    {
      type: "ambulance",
      name: "Скорая помощь",
      cost: 700,
      speed: 60,
      emoji: "🚑",
      img: "cars/СМП.png",
      role: "Скорая Медицинская Помощь – стандартная машина, выезжающая на все экстренные медицинские вызовы.",
      callType: "травмы, болезни, ДТП, роды и др."
    },
    {
      type: "rescue_ambulance",
      name: "Реанимобиль",
      cost: 900,
      speed: 65,
      emoji: "🚑",
      img: "cars/Реанимобиль.png",
      role: "Оснащён для интенсивной терапии и транспортировки тяжёлых пациентов.",
      callType: "инфаркт, инсульт, тяжёлые ДТП."
    },
    {
      type: "psp",
      name: "ПСП",
      cost: 750,
      speed: 60,
      emoji: "🚑",
      img: "cars/ПСП.png",
      role: "Подвижный Санитарный Пункт – мобильный госпиталь, развёртывается на месте ЧС.",
      callType: "массовые происшествия, природные катастрофы."
    },
    {
      type: "msp",
      name: "МСП",
      cost: 800,
      speed: 60,
      emoji: "🚑",
      img: "cars/МСП.png",
      role: "Мотоцикл Скорой Помощи – используется в городах с пробками, добирается до пациента быстрее.",
      callType: "экстренная первая помощь до прибытия СМП."
    }
  ],
  "Пожарная часть": [
    {
      type: "fire_truck",
      name: "ПСА",
      cost: 900,
      speed: 50,
      emoji: "🚒",
      img: "cars/ПСА.png",
      role: "Пожаро-спасательный автомобиль - основная машина пожаротушения, выезжает первой на вызов, оснащена всем необходимым для тушения пожара и спасения людей.",
      callType: "любые пожары, ДТП, ЧС."
    },
    {
      type: "ladder_truck",
      name: "АЛ",
      cost: 1100,
      speed: 45,
      emoji: "🚒",
      img: "cars/АЛ.png",
      role: "Автолестница – используется для эвакуации людей с высоты и подачи воды на верхние этажи.",
      callType: "пожары в многоэтажках, спасение с высоты."
    },
    {
      type: "tanker_truck",
      name: "АЦ",
      cost: 1000,
      speed: 45,
      emoji: "🚛",
      img: "cars/АЦ.png",
      role: "Автоцистерна – везёт запас воды и может подавать её в ПСА или напрямую.",
      callType: "крупные пожары, где требуется дополнительная подача воды."
    },
    {
      type: "aerial_platform",
      name: "АП",
      cost: 1200,
      speed: 45,
      emoji: "🚒",
      img: "cars/АП.png",
      role: "Пожарный автомобиль порошкового тушения – подаёт пену для тушения легковоспламеняющихся жидкостей.",
      callType: "пожары на автозаправках, химических объектах."
    },
    {
      type: "special_fire",
      name: "СПТ",
      cost: 1300,
      speed: 50,
      emoji: "🚒",
      img: "cars/СПТ.png",
      role: "Штабной Пожарный Транспорт – координация действий при масштабных ЧС.",
      callType: "крупные пожары, взрывы, массовые ЧС."
    },
    {
      type: "foam_truck",
      name: "АГ",
      cost: 1100,
      speed: 45,
      emoji: "🚒",
      img: "cars/АГ.png",
      role: "Автомобиль Газодымозащиты – разведка, спасение и вентиляция в задымлённых и токсичных помещениях.",
      callType: "пожары в подвалах, тоннелях, химических помещениях."
    }
  ],
  "Диспетчерский пункт": []
};

const vehicleImages = {};
for (const opts of Object.values(vehicleOptions)) {
  opts.forEach(o => { vehicleImages[o.type] = o.img; });
}
vehicleImages["mechanic"] = "cars/mechanic.png";

function getMechanicImage() {
  return vehicleImages["mechanic"];
}

function getVehicleImage(type) {
  return vehicleImages[type] || '';
}

function getVehicleNameByType(type) {
  for (const opts of Object.values(vehicleOptions)) {
    const found = opts.find(o => o.type === type);
    if (found) return found.name;
  }
  return type;
}

function formatRemainingRequirements(call) {
  const counts = {};
  (call.requiredVehicles || []).forEach(t => {
    counts[t] = (counts[t] || 0) + 1;
  });
  bases.forEach(base => {
    base.vehicles.forEach(v => {
      if (v.callId === call.id && ['enroute','onscene'].includes(v.status) && counts[v.type] > 0) {
        counts[v.type]--;
      }
    });
  });
  const parts = [];
  const sorted = sortVehicleTypes(Object.keys(counts));
  sorted.forEach(type => {
    const c = counts[type];
    if (c > 0) {
      const name = getVehicleNameByType(type);
      parts.push((c > 1 ? `x${c} ` : '') + name);
    }
  });
  return parts.join(', ');
}

function hasAllRequiredVehicles(call) {
  const counts = {};
  (call.requiredVehicles || []).forEach(t => {
    counts[t] = (counts[t] || 0) + 1;
  });
  bases.forEach(base => {
    base.vehicles.forEach(v => {
      if (v.callId === call.id && ['enroute','onscene'].includes(v.status) && counts[v.type] > 0) {
        counts[v.type]--;
      }
    });
  });
  return Object.values(counts).every(c => c <= 0);
}

function hasAllRequiredOnScene(call) {
  const counts = {};
  (call.requiredVehicles || []).forEach(t => {
    counts[t] = (counts[t] || 0) + 1;
  });
  bases.forEach(base => {
    base.vehicles.forEach(v => {
      if (v.callId === call.id && v.status === 'onscene' && counts[v.type] > 0) {
        counts[v.type]--;
      }
    });
  });
  return Object.values(counts).every(c => c <= 0);
}

function updateBalanceUI() {
  const el = document.getElementById('balance');
  if (el) el.textContent = `Баланс: ${balance}₽`;
}

function updateRatingUI() {
  const el = document.getElementById('rating');
  if (el) el.textContent = `Рейтинг: ${rating}`;
}

function addRatingHistory(change, reason) {
  ratingHistory.push({ time: Date.now(), change, reason });
  renderRatingHistory();
}

function renderRatingHistory() {
  const container = document.getElementById('rating-history');
  if (!container) return;
  container.innerHTML = '<h3>История рейтинга</h3>';
  ratingHistory.slice().reverse().forEach(entry => {
    const div = document.createElement('div');
    const sign = entry.change > 0 ? '+' : '';
    const time = new Date(entry.time).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' });
    div.textContent = `${time}: ${sign}${entry.change} (${entry.reason})`;
    container.appendChild(div);
  });
}

function toggleRatingHistory() {
  openHistoryModal();
}


function addBalanceHistory(change, reason) {
  balanceHistory.push({ time: Date.now(), change, reason });
  renderBalanceHistory();
}

function renderBalanceHistory() {
  const container = document.getElementById('balance-history');
  if (!container) return;
  container.innerHTML = '<h3>История баланса</h3>';
  balanceHistory.slice().reverse().forEach(entry => {
    const div = document.createElement('div');
    const sign = entry.change > 0 ? '+' : '';
    const time = new Date(entry.time).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' });
    div.textContent = `${time}: ${sign}${entry.change}₽ (${entry.reason})`;
    container.appendChild(div);
  });
}

function toggleBalanceHistory() {
  openHistoryModal();
}


function openHistoryModal() {
  const modal = document.getElementById('history-modal');
  if (!modal) return;
  modal.style.display = 'block';
  renderRatingHistory();
  renderBalanceHistory();
}

function closeHistoryModal() {
  const modal = document.getElementById('history-modal');
  if (modal) modal.style.display = 'none';
}

function setVehicleModalBackground(type) {
  const modal = document.getElementById('vehicle-modal');
  if (!modal) return;
  const content = modal.querySelector('.modal-content');
  if (!content) return;
  const dark = document.body.classList.contains('dark-mode');
  const img = shopBackgroundImages[type] || shopBackgroundImages['default'];
  const overlay = dark ? 'rgba(43,43,43,0.85)' : 'rgba(0,0,0,0.5)';
  if (img) {
    content.style.backgroundImage = `linear-gradient(${overlay}, ${overlay}), url('${img}')`;
    content.style.backgroundColor = '';
  } else {
    content.style.backgroundImage = '';
    content.style.backgroundColor = dark ? '#2b2b2b' : '#000';
  }
}

function openVehicleModal(baseId) {
  const base = bases.find(b => b.id === baseId);
  if (!base) return;

  const container = document.getElementById('vehicle-info');
  const modal = document.getElementById('vehicle-modal');
  if (!container || !modal) return;

  window.vehicleModalBaseType = base.type;
  setVehicleModalBackground(base.type);

  const cards = (vehicleOptions[base.type] || []).map(opt => {
    const missions = Object.values(callIcons)
      .filter(c => Array.isArray(c.vehicles) && c.vehicles.includes(opt.type))
      .map(c => `<li>${c.text}</li>`).join('') || '<li>Нет заданий</li>';
    return `
      <div class="vehicle-card">
        <h3>${opt.name}</h3>
        <img class="vehicle-img" src="${opt.img}" alt="${opt.name}">

        <p class="vehicle-role">${opt.role}</p>
        <p class="vehicle-calltype">✅ Тип вызова: ${opt.callType}</p>
        <p class="vehicle-price">Цена: <strong>${opt.cost}₽</strong></p>
        <button class="buy-btn" onclick="confirmBuyVehicle('${baseId}','${opt.type}')">Купить</button>
        <button onclick="addToCart('${baseId}', '${opt.type}')">В корзину</button>
        <div class="vehicle-missions">
          <button type="button" class="missions-toggle btn">Задания</button>
          <ul class="missions-list">${missions}</ul>
        </div>
      </div>`;
  }).join('');

  const cartButton = `<button class="btn cart-btn" onclick="openCartModal()">🛒 Корзина (<span class="cart-count">${getCartCount()}</span>)</button>`;
  container.innerHTML = `<div class="vehicle-list">${cards}</div>${cartButton}`;
  updateCartCount();
  modal.style.display = 'block';

  container.querySelectorAll('.missions-toggle').forEach(btn => {
    const list = btn.parentElement.querySelector('.missions-list');
    if (!list) return;
    btn.addEventListener('click', () => {
      const hidden = list.style.display === 'none';
      list.style.display = hidden ? 'block' : 'none';
      btn.textContent = hidden ? 'Скрыть задания' : 'Задания';
    });
    list.style.display = 'none';
  });
}


function closeVehicleModal() {
  const modal = document.getElementById('vehicle-modal');
  if (modal) modal.style.display = 'none';
  window.vehicleModalBaseType = null;
}

function confirmBuyVehicle(baseId, vtype) {

  closeVehicleModal();
  buyVehicle(baseId, vtype);
}
function getCartCount() {
  return cart.reduce((s, i) => s + i.count, 0);
}

function updateCartCount() {
  document.querySelectorAll('.cart-count').forEach(span => {
    span.textContent = getCartCount();
  });
}

function addToCart(baseId, type) {
  const base = bases.find(b => b.id === baseId);
  if (!base) return;
  const opt = (vehicleOptions[base.type] || []).find(o => o.type === type);
  if (!opt) return;
  const item = cart.find(c => c.baseId === baseId && c.type === type);
  if (item) item.count++; else cart.push({ baseId, type, count: 1 });
  saveCartToStorage();
  updateCartCount();
  showStatus(`🛒 ${opt.name} добавлен в корзину`);
}

function changeCartQuantity(baseId, type, delta) {
  const item = cart.find(c => c.baseId === baseId && c.type === type);
  if (!item) return;
  item.count += delta;
  if (item.count <= 0) {
    cart = cart.filter(c => !(c.baseId === baseId && c.type === type));
  }
  saveCartToStorage();
  openCartModal();
  updateCartCount();
}

function removeFromCart(baseId, type) {
  cart = cart.filter(c => !(c.baseId === baseId && c.type === type));
  saveCartToStorage();
  openCartModal();
  updateCartCount();
}

function openCartModal() {
  const modal = document.getElementById('cart-modal');
  const cont = document.getElementById('cart-content');
  if (!modal || !cont) return;
  if (cart.length === 0) {
    cont.innerHTML = '<p>Корзина пуста</p>';
  } else {
    let total = 0;
    const items = cart.map(it => {
      const b = bases.find(x => x.id === it.baseId);
      if (!b) return '';
      const opt = (vehicleOptions[b.type] || []).find(o => o.type === it.type);
      if (!opt) return '';
      const cost = opt.cost * it.count;
      total += cost;
      return `<li><span>${b.name}: ${opt.name} x${it.count} (${cost}₽)</span><div class="cart-item-actions"><button class="btn" onclick=\"changeCartQuantity('${it.baseId}','${it.type}',1)\">+</button> <button class="btn" onclick=\"changeCartQuantity('${it.baseId}','${it.type}',-1)\">-</button> <button class="btn btn-danger" onclick=\"removeFromCart('${it.baseId}','${it.type}')\">❌</button></div></li>`;
    }).join('');
    cont.innerHTML = `<ul>${items}</ul><p>Итого: <strong>${total}₽</strong></p><button class="btn" onclick="purchaseCart()">Купить все</button>`;
  }
  modal.style.display = 'block';
}

function closeCartModal() {
  const modal = document.getElementById('cart-modal');
  if (modal) modal.style.display = 'none';
}

async function purchaseCart() {
  const remaining = [];
  for (const item of cart) {
    const success = await buyVehicles(item.baseId, item.type, item.count);
    if (!success) remaining.push(item);
  }
  cart = remaining;
  saveCartToStorage();
  updateCartCount();
  if (cart.length === 0) {
    closeCartModal();
  } else {
    openCartModal();
  }
}

async function openProfileModal() {
  const container = document.getElementById('profile-content');
  const modal = document.getElementById('profile-modal');
  if (!container || !modal) return;
  try {
    const res = await fetch('profile.php' + userQuery);
    const data = await res.json();
    const last = data.last_online ? new Date(data.last_online).toLocaleString() : 'никогда';
    const status = data.online ? 'В сети' : `Не в сети (был: ${last})`;
    container.innerHTML = `
      <p><strong>Статус:</strong> <span id="profile-online">${status}</span></p>
      <textarea id="profile-status-text" rows="3" placeholder="Ваш статус...">${data.status_text || ''}</textarea>
      <button class="btn" onclick="saveProfileStatus()">Сохранить</button>
      <div id="chat-box">
        <div id="chat-messages" style="max-height:200px;overflow-y:auto;border:1px solid #ccc;margin-top:10px;padding:4px;"></div>
        <input type="text" id="chat-input" placeholder="Сообщение..." style="width:70%;">
        <button class="btn" onclick="sendChat()">Отправить</button>
      </div>`;
    modal.style.display = 'block';
    chatLastId = 0;
    loadChat();
    connectSocket();
  } catch(e){ console.error(e); }
}

function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.style.display = 'none';
}

function openBugReportModal() {
  const modal = document.getElementById('bug-report-modal');
  const frame = document.getElementById('bug-report-frame');
  if (modal) {
    if (frame) {
      frame.onload = function() {
        try {
          const doc = frame.contentWindow.document;
          const box = doc.querySelector('.bug-report-box');
          if (box) {
            const content = modal.querySelector('.modal-content');
            if (content) {
              content.style.width = box.offsetWidth + 'px';
              content.style.height = box.offsetHeight + 'px';
            }
          }
        } catch (e) {}
      };
      frame.src = 'bug_report.php?embedded=1&t=' + Date.now();
    }
    modal.style.display = 'block';
  }
}

function closeBugReportModal() {
  const modal = document.getElementById('bug-report-modal');
  if (modal) modal.style.display = 'none';
}

function collectDispatcherVehicles(dispatcher) {
  const list = [];
  bases.forEach(b => {
    if (b.type === 'Диспетчерский пункт' || b.id === dispatcher.id) return;
    if (isPointInZone([b.lat, b.lng], dispatcher)) {
      b.vehicles.forEach(v => {
        if (v.status === 'idle') list.push({ base: b, vehicle: v });
      });
    }
  });
  return list;
}

async function sendVehicleToCall(callId, baseId, vehicleId) {
  const call = callMarkers.find(c => c.id === callId);
  const base = bases.find(b => b.id === baseId);
  if (!call || !base) return;

  const vehicle = base.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return;

  if (vehicle.status !== 'idle') {
    showStatus('❌ Машина уже занята');
    return;
  }

  // Назначаем машину на вызов
  vehicle.status = 'enroute';
  vehicle.callId = call.id;
  if (!Array.isArray(call.assignedVehicles)) call.assignedVehicles = [];
  call.assignedVehicles.push({ baseId: base.id, vehicleId: vehicle.id });
  call.assigned = true;

  // Добавляем машину в список "Машины"
  const vehicleList = document.querySelector('.call-vehicle-list');
  if (vehicleList) {
    const name = vehicle.name || getVehicleNameByType(vehicle.type);
    const status = getStatusText(vehicle.status, vehicle.type);
    const item = document.createElement('li');
    // Remove placeholder if this is the first vehicle
    const placeholder = vehicleList.querySelector('.no-vehicles');
    if (placeholder) placeholder.remove();
    const recallBtn = `<button class="btn recall-btn" onclick="recallVehicle('${base.id}','${vehicle.id}')">⏹ Отозвать</button>`;
    const dist = getDistance(base.lat, base.lng, call.lat, call.lng);
    const eta = formatElapsedTime(estimateTravelTime(dist, vehicle.speed));
    item.innerHTML = `${recallBtn}<span class="vehicle-label" data-call="${call.id}" data-vehicle="${vehicle.id}">${name}<br>${status}</span>`+
      `<small class="arrival" data-call="${call.id}" data-vehicle="${vehicle.id}">${eta}</small>`+
      `<div class="progress-container"><div class="progress-bar vehicle-progress" data-call="${call.id}" data-vehicle="${vehicle.id}" style="width:${vehicle.routeProgress || 0}%"></div></div>`;
    vehicleList.appendChild(item);
  }

  // Удаляем машину из меню доступных
  const dispatchBlocks = document.querySelectorAll('.dispatch-block');
  dispatchBlocks.forEach(block => {
    const lis = block.querySelectorAll('li');
    lis.forEach(li => {
      if (li.innerHTML.includes(vehicle.id)) {
        li.remove(); // старая версия, если был id
      } else if (li.textContent.includes(vehicle.name)) {
        // более надёжная версия — по совпадению имени
        const button = li.querySelector('button');
        if (
          button &&
          button.getAttribute('onclick') &&
          button.getAttribute('onclick').includes(vehicle.id)
        ) {
          li.remove();
        }
      }
    });
  });

  saveCalls();
  updateCallListUI();
  refreshCallMenu(call.id);

  // Прокладываем маршрут
  const route = await getRoute({ lat: base.lat, lng: base.lng }, { lat: call.lat, lng: call.lng });
  const smoothRoute = densifyRoute(route);
  const arrSpan = document.querySelector(`.arrival[data-call="${call.id}"][data-vehicle="${vehicle.id}"]`);
  if (arrSpan) {
    const etaMs = estimateTravelTime(computeRouteDistance(smoothRoute), vehicle.speed);
    arrSpan.textContent = formatElapsedTime(etaMs);
  }
  moveVehicle(base, vehicle, call, smoothRoute);
}


function openCallMenu(id) {
  const call = callMarkers.find(c => c.id === id);
  if (!call) return;
  const container = document.getElementById('call-content');
  const modal = document.getElementById('call-modal');
  if (!container || !modal) return;
  container.dataset.callId = call.id;
  const progressHtml = `<div class="progress-container"><div class="progress-bar" data-call="${call.id}" style="width:${call.progress}%"></div></div>`;

  const vehicles = (call.assignedVehicles || []).map(ref => {
    const base = bases.find(b => b.id === ref.baseId);
    const v = base && base.vehicles.find(x => x.id === ref.vehicleId);
    if (!v) return null;
    const name = v.name || getVehicleNameByType(v.type);
    const status = getStatusText(v.status, v.type);
    const vp = (typeof v.routeProgress === 'number') ? v.routeProgress : (v.status === 'onscene' ? 100 : 0);
    const btn = ['enroute','onscene'].includes(v.status)
      ? `<button class="btn recall-btn" onclick="recallVehicle('${base.id}','${v.id}')">⏹ Отозвать</button>`
      : '';
    let arrival = '';
    if (v.status === 'enroute') {
      if (v.route && v.route.length > 1) {
        const remaining = computeRouteDistance(v.route) * (1 - (v.routeProgress || 0) / 100);
        arrival = formatElapsedTime(estimateTravelTime(remaining, v.speed));
      } else {
        const dist = getDistance(v.lat, v.lng, call.lat, call.lng);
        arrival = formatElapsedTime(estimateTravelTime(dist, v.speed));
      }
    } else if (v.status === 'onscene') {
      arrival = '';
    }
    return `<li>${btn}<span class="vehicle-label" data-call="${call.id}" data-vehicle="${v.id}">${name}<br>${status}</span>`+
           `<small class="arrival" data-call="${call.id}" data-vehicle="${v.id}">${arrival}</small>`+
           `<div class="progress-container"><div class="progress-bar vehicle-progress" data-call="${call.id}" data-vehicle="${v.id}" style="width:${vp}%"></div></div></li>`;
  }).filter(Boolean).join('') || '<li class="no-vehicles">Нет</li>';

  const allRequired = hasAllRequiredOnScene(call);
  let etaText = 'Ожидание машин...';
  if (allRequired) {
    const remaining = getRemainingTime(call);
    etaText = formatElapsedTime(remaining);
  }
  const etaHtml = allRequired
    ? `⏳ До конца: <span class="eta" data-call="${call.id}">${etaText}</span>`
    : '⏳ Ожидает машин';
  const eta = `<div class="eta-container" data-call="${call.id}">${etaHtml}</div>`;

  const dispatchers = bases.filter(b => b.type === 'Диспетчерский пункт');
  dispatchers.sort((a, b) => {
    if (a.id === call.dispatcherId) return -1;
    if (b.id === call.dispatcherId) return 1;
    const da = getDistance(a.lat, a.lng, call.lat, call.lng);
    const db = getDistance(b.lat, b.lng, call.lat, call.lng);
    return da - db;
  });

  let dispatchHtml = '';
  dispatchers.forEach(d => {
    const list = collectDispatcherVehicles(d);
    list.sort((x, y) => getDistance(x.vehicle.lat, x.vehicle.lng, call.lat, call.lng) -
      getDistance(y.vehicle.lat, y.vehicle.lng, call.lat, call.lng));

    const groups = {};
    list.forEach(obj => {
      const cat = vehicleCategory[obj.vehicle.type] || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(obj);
    });

    const titles = { police: 'Полиция', fire: 'Пожарные', medical: 'Больница', other: 'Другое' };
    let items = '';
    Object.keys(titles).forEach(cat => {
      const arr = groups[cat];
      if (!arr || !arr.length) return;
      const lis = arr.map(obj => {
        const name = obj.vehicle.name || getVehicleNameByType(obj.vehicle.type);
        const dist = getDistance(obj.vehicle.lat, obj.vehicle.lng, call.lat, call.lng);
        const time = formatElapsedTime(estimateTravelTime(dist, obj.vehicle.speed));
        const img = getVehicleImage(obj.vehicle.type);
        const iconHtml = img ? `<img src="${img}" alt="">` : obj.vehicle.emoji;
        return `<li><button class="btn send-vehicle-btn" onclick="sendVehicleToCall('${call.id}','${obj.base.id}','${obj.vehicle.id}')">${iconHtml}</button> ${name} (${time})</li>`;
      }).join('');
      if (lis) {
        items += `<div class="vehicle-group"><div class="vehicle-group-title">${titles[cat]}</div><ul class="available-list">${lis}</ul></div>`;
      }
    });
    if (!items) items = '<div class="vehicle-group"><ul class="available-list"><li>Нет свободных машин</li></ul></div>';
    dispatchHtml += `<div class="dispatch-block"><div><strong>${d.name}</strong></div>${items}</div>`;
  });

  container.innerHTML = `
    <div class="call-modal-buttons">
      <button class="btn" onclick="zoomToCall('${call.id}')">🗺 Показать</button>
      <button class="btn btn-danger" onclick="removeCall('${call.id}')">✅ Завершить</button>
    </div>
    <div class="call-modal-left">
      <h3>${call.text}</h3>
      <div>📍 ${call.address}</div>
      ${progressHtml}
      ${eta}
      ${call.requiredVehicles && call.requiredVehicles.length ? `<div class="call-required" data-call="${call.id}"><strong>Нужно:</strong> ${formatRemainingRequirements(call) || 'Т/с отправлены'}</div>` : ''}
      <div><strong>Машины:</strong><ul class="call-vehicle-list">${vehicles}</ul></div>
    </div>
    <div class="call-modal-right">
      <strong>Доступные:</strong>${dispatchHtml}
    </div>`;
  modal.style.display = 'block';
}

function closeCallModal() {
  const modal = document.getElementById('call-modal');
  if (modal) modal.style.display = 'none';
}

function refreshCallMenu(id) {
  const call = callMarkers.find(c => c.id === id);
  if (!call) return;

  // Обновление шкалы прогресса
  const bar = document.querySelector(`.progress-bar[data-call="${id}"]`);
  if (bar) bar.style.width = `${call.progress}%`;

  // Обновление ETA
  const etaCont = document.querySelector(`.eta-container[data-call="${id}"]`);
  if (etaCont) {
    const allRequired = hasAllRequiredOnScene(call);
    let etaText = 'Ожидание машин...';
    if (allRequired) {
      const remaining = getRemainingTime(call);
      etaText = formatElapsedTime(remaining);
    }
    etaCont.innerHTML = allRequired
      ? `⏳ До конца: <span class="eta" data-call="${id}">${etaText}</span>`
      : '⏳ Ожидает машин';
  }

  const reqCont = document.querySelector(`.call-required[data-call="${id}"]`);
  if (reqCont) {
    const text = formatRemainingRequirements(call) || 'Т/с отправлены';
    reqCont.innerHTML = `<strong>Нужно:</strong> ${text}`;
  }

  // Update vehicle route progress bars
  const vehicleBars = document.querySelectorAll(`.vehicle-progress[data-call="${id}"]`);
  vehicleBars.forEach(bar => {
    const vid = bar.getAttribute('data-vehicle');
    let vehicle;
    for (const b of bases) {
      vehicle = b.vehicles.find(v => v.id === vid);
      if (vehicle) break;
    }
    if (vehicle) {
      const vp = typeof vehicle.routeProgress === 'number'
        ? vehicle.routeProgress
        : (vehicle.status === 'onscene' ? 100 : 0);
      bar.style.width = vp + '%';
      const label = document.querySelector(`.vehicle-label[data-call="${id}"][data-vehicle="${vid}"]`);
      if (label) {
        const name = vehicle.name || getVehicleNameByType(vehicle.type);
        label.innerHTML = `${name}<br>${getStatusText(vehicle.status, vehicle.type)}`;
      }
      const arr = document.querySelector(`.arrival[data-call="${id}"][data-vehicle="${vid}"]`);
      if (arr) {
        if (vehicle.status === 'enroute' && vehicle.route && vehicle.route.length > 1) {
          const remaining = computeRouteDistance(vehicle.route) * (1 - (vehicle.routeProgress || 0) / 100);
          const ms = estimateTravelTime(remaining, vehicle.speed);
          arr.textContent = formatElapsedTime(ms);
        } else {
          arr.textContent = '';
        }
      }
      if (vehicle.status === 'onscene') {
        if (vehicle.marker) { map.removeLayer(vehicle.marker); vehicle.marker = null; }
        if (vehicle.polyline) { map.removeLayer(vehicle.polyline); vehicle.polyline = null; }
      }
    }
  });
}


async function saveProfileStatus() {
  const text = document.getElementById('profile-status-text').value;
  await fetch('profile.php', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({status_text:text})
  });
  closeProfileModal();
}

let chatLastId = 0;
function connectSocket() {
  if (socket) return;
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.hostname;
  socket = io(`${wsProto}://${host}:3000`);
  socket.on('connect', () => {
    console.log('Socket connected');
  });
  socket.on('connect_error', err => {
    console.error('Socket connection error:', err);
  });
  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });
  socket.on('chat message', msg => {
    appendChatMessage(msg);
  });

  socket.on('balance update', data => {
    if (typeof data.balance === 'number') {
      balance = data.balance;
      updateBalanceUI();
    }
  });

  socket.on('rating update', data => {
    if (typeof data.rating === 'number') {
      rating = data.rating;
      updateRatingUI();
    }
  });
}

function appendChatMessage(msg) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const div = document.createElement('div');
  const time = msg.time ? new Date(msg.time) : new Date();
  div.textContent = `[${time.toLocaleTimeString()}] ${msg.username}: ${msg.message}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function loadChat() {
  try {
    const res = await fetch('chat.php?since=' + chatLastId);
    const data = await res.json();
    const box = document.getElementById('chat-messages');
    if (!box) return;
    data.forEach(msg => {
      appendChatMessage({
        username: msg.username,
        message: msg.message,
        time: new Date(msg.created_at).getTime()
      });
      chatLastId = msg.id;
    });
  } catch(e){ console.error(e); }
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value='';
  await fetch('chat.php', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({message:msg})
  });
  if (socket) {
    socket.emit('chat message', {
      username: window.currentUser || 'unknown',
      message: msg
    });
  }
  appendChatMessage({username: window.currentUser || 'Я', message: msg});
}

function updateVehicleCardHeights(container) {
  const cards = container.querySelectorAll('.vehicle-card');
  let maxHeight = 0;
  cards.forEach(c => {
    c.style.height = 'auto';
    if (c.offsetHeight > maxHeight) maxHeight = c.offsetHeight;
  });
  cards.forEach(c => {
    c.style.height = maxHeight + 'px';
  });
}
async function sendHistory(type, change, reason) {
  try {
    await fetch('history.php' + userQuery, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, change, reason })
    });
  } catch (e) {
    console.error('Ошибка отправки истории:', e);
  }
}

async function saveBalance(change = 0, reason = '') {
  if (change !== 0) {
    addBalanceHistory(change, reason);
    sendHistory('balance', change, reason);
  }
  updateBalanceUI();
  if (socket) {
    socket.emit('balance update', { balance });
  }
  await saveGameData();
}

async function saveRating(change = 0, reason = '') {
  if (change !== 0) {
    addRatingHistory(change, reason);
    sendHistory('rating', change, reason);
  }
  updateRatingUI();
  if (socket) {
    socket.emit('rating update', { rating });
  }
  await saveGameData();
}

function loadBalance() {
  updateBalanceUI();
}

function loadRating() {
  updateRatingUI();
}


// Сохраняем базы на сервере (без marker, потому что нельзя сериализовать)
function sanitizeVehicle(v) {
  return {
    id: v.id,
    type: v.type,
    name: v.name,
    emoji: v.emoji,
    speed: v.speed,
    status: v.status,
    lat: v.lat,
    lng: v.lng,
    mileage: v.mileage || 0,
    condition: Math.round(v.condition || 100),
    callId: v.callId || null,
    route: Array.isArray(v.route) ? v.route : null,
    routeProgress: v.routeProgress || 0 // ← добавлено
  };
}


function saveBases(skipRender = false) {
  if (!skipRender) {
    renderBases();
  }
  return saveGameData();
}

// Добавление здания
async function addBase(lat, lng, nameFromStorage = null, typeFromStorage = null) {
  if (actionLock) return false;
  actionLock = true;
  try {
    const type = typeFromStorage || getSelectedBaseType();
    const name = nameFromStorage || getDefaultBaseName(type);
    const icon = icons[type] || icons["Полицейский участок"];

  const cost = baseCosts[type] || 0;
  if (balance < cost) {
    showStatus('❌ Недостаточно средств для строительства здания');
    return false;
  }

  balance -= cost;
  await saveBalance(-cost, 'Строительство здания');

  const address = await getAddressFromCoords(lat, lng);

  const baseId = generateBaseID();
  const marker = L.marker([lat, lng], { icon })
    .addTo(map)
    .on("click", () => openBasePanel(baseId));

  const base = {
    id: baseId,
    name,
    lat,
    lng,
    type,
    address,
    level: 1,
    active: true,
    vehicles: [],
    personnel: [],
    upgrades: [],
    missions: [],
    marker,
    serviceStation: null,
    radius: type === 'Диспетчерский пункт' ? 1000 : 0,
    callInterval: 60000,
    zone: null,
    callCircle: null,
    locked: false
  };

  bases.push(base);
  attachBaseHoverEvents(base);
  if (base.type === 'Диспетчерский пункт') startDispatcher(base);
  updateBaseLocks();
  saveBases();
  showStatus(`✅ Построено здание: ${name} (${type})`);
  return true;
  } finally {
    actionLock = false;
  }
}



function loadBases() {
  renderBases();
}

function renderBases() {
  // Удалить все маркеры с карты
  bases.forEach(b => {
    if (b.marker) {
      map.removeLayer(b.marker);
    }
  });

  // Перерисовать маркеры
  bases.forEach(base => {
      const icon = icons[base.type] || icons["Полицейский участок"];
      const marker = L.marker([base.lat, base.lng], { icon })
        .addTo(map)
        .on("click", () => openBasePanel(base.id));
    base.marker = marker;
    attachBaseHoverEvents(base);
    if (base.type === 'Диспетчерский пункт' && base.active && !dispatcherIntervals[base.id]) {
      startDispatcher(base);
    }
  });
  if (openBaseId) {
    // повторно открываем панель управления, если была открыта
    openBasePanel(openBaseId);
  }
}

async function renderVehicles() {
  bases.forEach(base => {
    base.vehicles.forEach(async v => {
      if (v.marker) map.removeLayer(v.marker);
      if (v.polyline) map.removeLayer(v.polyline);

      if (v.status === 'enroute') {
        const img = getVehicleImage(v.type);
        const html = img ? `<img src="${img}" alt="">` : v.emoji;
        v.marker = L.marker([v.lat, v.lng], {
          icon: L.divIcon({ className: 'vehicle-marker', html, iconSize: [64, 64], iconAnchor: [32, 32] })
        }).addTo(map);
        const call = callMarkers.find(c => c.id === v.callId);
        if (call) {
          let smooth;
          if (Array.isArray(v.route) && v.route.length > 1) {
            smooth = v.route;
          } else {
            const route = await getRoute({ lat: v.lat, lng: v.lng }, { lat: call.lat, lng: call.lng });
            smooth = densifyRoute(route);
          }
          v.polyline = L.polyline(smooth, { color: 'blue' }).addTo(map);
          animateRoute(v, smooth, () => {
            if (v.marker) { map.removeLayer(v.marker); v.marker = null; }
            v.lat = call.lat;
            v.lng = call.lng;
            v.status = 'onscene';
            if (v.polyline) { map.removeLayer(v.polyline); v.polyline = null; }
            v.route = null;
            v.routeProgress = 100;
            saveBases(true);
            refreshBasePanel(base.id);
            refreshCallMenu(call.id);
          }, (v.routeProgress || 0) / 100);
        } else {
          v.status = 'idle';
          v.callId = null;
      v.lat = base.lat;
      v.lng = base.lng;
      }
      } else if (v.status === 'transport' || v.status === 'return') {
        const img = getVehicleImage(v.type);
        const html = img ? `<img src="${img}" alt="">` : v.emoji;
        v.marker = L.marker([v.lat, v.lng], {
          icon: L.divIcon({ className: 'vehicle-marker', html, iconSize: [64, 64], iconAnchor: [32, 32] })
        }).addTo(map);
        let smooth;
        if (Array.isArray(v.route) && v.route.length > 1) {
          smooth = v.route;
        } else {
          const route = await getRoute({ lat: v.lat, lng: v.lng }, { lat: base.lat, lng: base.lng });
          smooth = densifyRoute(route);
        }
        v.polyline = L.polyline(smooth, { color: 'blue' }).addTo(map);
        animateRoute(v, smooth, () => {
  try {
    if (v.marker) map.removeLayer(v.marker);
    if (v.polyline) map.removeLayer(v.polyline);
  } catch (e) {
    console.warn("⚠️ Ошибка при очистке слоёв:", e);
  }
          v.status = 'idle';
          v.callId = null;
          v.lat = base.lat;
          v.lng = base.lng;
          v.marker = null;
          v.polyline = null;
          v.route = null;
          saveBases(true);
        refreshBasePanel(base.id);
      }, (v.routeProgress || 0) / 100);
      } else if (v.status === 'onscene') {
        const call = callMarkers.find(c => c.id === v.callId);
        const active = call && call.progress < 100;
        if (!active) {
          const route = await getRoute({ lat: v.lat, lng: v.lng }, { lat: base.lat, lng: base.lng });
          const smooth = densifyRoute(route);
          setTimeout(() => returnToBase(base, v, smooth), 2000);
        }
      } else if (v.status === 'waiting_tow') {
        const img = getVehicleImage(v.type);
        const html = img ? `<img src="${img}" alt="">` : v.emoji;
        v.marker = L.marker([v.lat, v.lng], {
          icon: L.divIcon({ className: 'vehicle-marker', html, iconSize: [64, 64], iconAnchor: [32, 32] })
        }).addTo(map);
      }
    });
    if (base.serviceStation && base.serviceStation.mechanic) {
      const m = base.serviceStation.mechanic;
      if (m.marker) {
        const pos = m.marker.getLatLng();
        m.lat = pos.lat;
        m.lng = pos.lng;
      }
      if (m.polyline && typeof m.polyline.getLatLngs === 'function') {
        const ll = m.polyline.getLatLngs();
        if (Array.isArray(ll) && ll.length) {
          m.route = ll.map(p => [p.lat, p.lng]);
        }
      }
    }
  });
}




function isVehicleInBase(vehicle, base) {
  return vehicle.status === 'idle' && vehicle.lat === base.lat && vehicle.lng === base.lng;
}

function removeBaseById(id, showMsg = true) {
  const index = bases.findIndex(b => b.id === id);
  if (index === -1) return false;

  const base = bases[index];
  const allInBase = base.vehicles.every(v => isVehicleInBase(v, base));
  if (!allInBase) {
    if (showMsg) showStatus('❌ Нельзя удалить здание: машины находятся в пути');
    return false;
  }

  // Удаляем маркеры машин, если остались
  base.vehicles.forEach(v => {
    if (v.marker) map.removeLayer(v.marker);
    if (v.polyline) map.removeLayer(v.polyline);
  });

  if (base.type === 'Диспетчерский пункт') stopDispatcher(base.id);

  // Удаляем маркер базы
  map.removeLayer(base.marker);

  // Удаляем из массива
  bases.splice(index, 1);
  cleanCart();
  updateCartCount();

  // Сохраняем обновлённый список
  updateBaseLocks();
  saveBases();

  if (showMsg) showStatus('❌ Здание удалено');
  return true;
}

function openBasePanel(id) {
  const base = bases.find(b => b.id === id);
  if (!base) return;
  const panel = document.getElementById('base-panel');
  const modal = document.getElementById('base-modal');
  if (!panel || !modal) return;
  openBaseId = id;
  const salePrice = Math.floor((baseCosts[base.type] || 0) * 0.8);
  if (base.type === 'Диспетчерский пункт') {
    const inZone = bases.filter(b => b.id !== base.id && b.type !== 'Диспетчерский пункт' && isPointInZone([b.lat, b.lng], base));
    const list = inZone.map(b => `<li><a href="#" onclick="openBaseFromList('${b.id}');return false;">${b.name}</a></li>`).join('') || '<li>Нет зданий</li>';
    panel.className = 'dispatcher';
    panel.innerHTML = `
      <h3>${base.name}</h3>
      <div class="name-edit">
        <label>Название:</label>
        <input id="base-name-field" value="${base.name}">
      </div>
      <button id="save-name-btn" class="save-btn" style="display:none;" onclick="saveBaseChanges('${id}')">💾 Сохранить</button>
      <div>Статус: <strong>${base.active ? 'активен' : 'остановлен'}</strong></div>
      <button onclick="toggleDispatcher('${id}')" class="${base.active ? 'stop-btn' : 'start-btn'}">${base.active ? '⏹ Остановить' : '▶ Запустить'}</button>
      <div class="interval-btn-group">
        <span>Интервал вызовов:</span>
        <div>
          <button class="interval-btn" data-val="30">30с</button>
          <button class="interval-btn" data-val="60">60с</button>
          <button class="interval-btn" data-val="120">120с</button>
          <button class="interval-btn" data-val="180">180с</button>
        </div>
        <input id="call-interval-field" type="hidden" value="${(base.callInterval || 60000)/1000}">
      </div>
      <button id="save-interval-btn" class="save-btn" style="display:none;" onclick="saveCallInterval('${id}', false)">💾 Сохранить</button>
      <button id="save-interval-all-btn" class="save-btn" style="display:none;" onclick="saveCallInterval('${id}', true)">💾 Для всех</button>
      <div><strong>Здания в зоне:</strong><ul class="zone-list">${list}</ul></div>
      <button onclick="startZoneEdit('${id}')">✏️ Зона</button>
      <button onclick="startMoveBase('${id}')">📍 Переместить</button>
      <button onclick="sellBase('${id}')">💰 Продать (${salePrice}₽)</button>
    `;
    modal.querySelector('.modal-content').classList.add('dispatcher-menu');
  } else {
    panel.className = '';
    const disp = bases.find(b => b.type === 'Диспетчерский пункт' && isPointInZone([base.lat, base.lng], b));
    const dispInfo = disp ? `<div>Диспетчерский пункт: <a href="#" onclick="openBaseFromList('${disp.id}');return false;">${disp.name}</a></div>` : '<div>Не обслуживается диспетчерской</div>';
    if (base.locked) {
      panel.innerHTML = `
        <h3>${base.name}</h3>
        ${dispInfo}
        <div class="locked-msg">Здание заблокировано. Переместите его в зону диспетчерского пункта.</div>
        <button onclick="startMoveBase('${id}')">📍 Переместить</button>
        <button onclick="sellBase('${id}')">💰 Продать (${salePrice}₽)</button>
      `;
    } else {
      const vehicleList = base.vehicles.map(v => {
        const opt = (vehicleOptions[base.type] || []).find(o => o.type === v.type);
        const sale = opt ? Math.floor(opt.cost * 0.8) : 0;
        const img = getVehicleImage(v.type);
        const iconHtml = img ? `<img src="${img}" alt="">` : v.emoji;
        const sellBtn = isVehicleInBase(v, base)
          ? `<button class="sell-vehicle-btn" onclick="sellVehicle('${base.id}', '${v.id}')">💰 Продать (${sale}₽)</button>`
          : '';
        let recallBtn = '';
        if (!isVehicleInBase(v, base) && ['enroute','onscene'].includes(v.status)) {
          const handler = `recallVehicle('${base.id}','${v.id}')`;
          recallBtn = `<button onclick=\"${handler}\">⏹ Отозвать</button>`;
        }
        let returnBtn = '';
        if (window.isAdminView && !isVehicleInBase(v, base)) {
          const handler = `forceReturnVehicle('${base.id}','${v.id}')`;
          returnBtn = `<button onclick=\"${handler}\">⏹ Вернуть</button>`;
        }
        const serviceCost = getServiceCost(base);
        const mechanicBusy = base.serviceStation && base.serviceStation.mechanic && base.serviceStation.mechanic.status !== 'idle';
        const serviceBtn = base.serviceStation && base.serviceStation.master && v.condition < 100 ? `<button class="service-btn${mechanicBusy ? ' busy' : ''}" ${mechanicBusy ? 'title="Механик на выезде" disabled' : `onclick=\"serviceVehicle('${base.id}','${v.id}')\"`}>ТО (${serviceCost}₽)</button>` : '';
        const repairBtn = base.serviceStation && base.serviceStation.master && base.serviceStation.towTruck && !isVehicleInBase(v, base) && v.condition < 100 ? `<button onclick="repairVehicleOnSite('${base.id}','${v.id}')">Выездной ремонт (${ONSITE_REPAIR_BASE}₽ + ${ONSITE_REPAIR_PER_KM}₽/км)</button>` : '';
        return `<li>
            <div class="vehicle-info">
              <span class="vehicle-name">${iconHtml} ${v.name}</span>
              <span class="vehicle-status">Статус: ${getStatusText(v.status, v.type)}</span>
              <span class="vehicle-mileage">Пробег: ${Math.round(v.mileage || 0)} км</span>
              <span class="vehicle-condition">Состояние: ${Math.round(v.condition || 0)}%</span>
            </div>
            <div class="vehicle-actions"><div class="maint-col">${serviceBtn} ${repairBtn} ${recallBtn} ${returnBtn}</div><div class="sell-col">${sellBtn}</div></div>
          </li>`;
      }).join('') || '<li>Нет машин</li>';
      panel.innerHTML = `
        <div class="base-container">
          <div class="base-info">
            <h3>${base.name}</h3>
            ${dispInfo}
            <div class="name-edit">
              <label>Название:</label>
              <input id="base-name-field" value="${base.name}">
            </div>
            <button id="save-name-btn" class="save-btn" style="display:none;" onclick="saveBaseChanges('${id}')">💾 Сохранить</button>
            <label>Уровень:<input id="base-level-field" type="number" min="1" value="${base.level}" oninput="document.getElementById('base-capacity').textContent=this.value*3"></label>
            <button id="save-level-btn" class="save-btn" style="display:none;" onclick="saveBaseChanges('${id}')">💾 Сохранить</button>
            <div>Вместимость машин: <span id="base-capacity">${base.level * 3}</span></div>
            ${base.serviceStation ? `
              <div><strong>СТО (уровень ${base.serviceStation.level}/${MAX_STO_LEVEL})</strong>${base.serviceStation.master ? `: ${base.serviceStation.master.name} (ур. ${base.serviceStation.master.skill}, зп ${base.serviceStation.master.salary}₽)` : ': без мастера'}</div>
              ${base.serviceStation.hiring ? '<div>Найм мастера...</div>' :
                `<div class="hire-master" id="master-action-${id}"><button onclick="showMasterSelect('${id}')">${base.serviceStation.master ? 'Сменить мастера' : 'Нанять мастера'}</button></div>`}
              ${base.serviceStation.towTruck ? '<div>Эвакуатор: куплен</div>' : `<button onclick="buyTowTruck('${id}')">Купить эвакуатор (${TOW_TRUCK_COST}₽)</button>`}
              ${base.serviceStation.level < MAX_STO_LEVEL ? (base.serviceStation.upgrading ? '<div>Улучшение...</div>' : `<button onclick="upgradeServiceStation('${id}')">⬆️ Улучшить СТО (${1000 * base.serviceStation.level}₽)</button>`) : ''}
              ${base.vehicles.some(v => v.condition < 100) && base.serviceStation.master ? `<button ${base.serviceStation.mechanic && base.serviceStation.mechanic.status !== 'idle' ? 'class="busy" title="Механик на выезде" disabled' : 'onclick="serviceAllVehicles(\'${id}\')"'}>🔧 ТО всех машин (${base.vehicles.filter(v => v.condition < 100).length * getServiceCost(base)}₽)</button>` : ''}            ` : `<div><strong>СТО не построено</strong></div><button onclick="buyServiceStation('${id}')">Купить СТО (${STO_COST}₽)</button>`}
            <button onclick="startMoveBase('${id}')">📍 Переместить</button>
            <button onclick="sellBase('${id}')">💰 Продать (${salePrice}₽)</button>
          </div>
          <div class="vehicles-section">
            <strong>Машины (${base.vehicles.length}/${base.level * 3})</strong>
            <button onclick="openVehicleModal('${id}')">🚗 Купить транспорт</button>
            <button onclick="openCartModal()">🛒 Корзина (<span class="cart-count">${getCartCount()}</span>)</button>
            <ul id="vehicle-list">${vehicleList}</ul>
          </div>
        </div>
      `;
    }
    modal.querySelector('.modal-content').classList.remove('dispatcher-menu');
  }
  modal.style.display = 'block';
  const nameInput = document.getElementById('base-name-field');
  const saveNameBtn = document.getElementById('save-name-btn');
  const levelField = document.getElementById('base-level-field');
  const saveLevelBtn = document.getElementById('save-level-btn');
  const radiusField = document.getElementById('base-radius-field');
  const intervalField = document.getElementById('call-interval-field');
  const saveIntervalBtn = document.getElementById('save-interval-btn');
  const saveIntervalAllBtn = document.getElementById('save-interval-all-btn');
  const intervalButtons = panel.querySelectorAll('.interval-btn');
  intervalButtons.forEach(btn => {
    if (parseInt(btn.dataset.val) === parseInt(intervalField.value)) {
      btn.classList.add('selected');
    }
    btn.addEventListener('click', () => {
      intervalButtons.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      intervalField.value = btn.dataset.val;
      checkChanges();
    });
  });
  function checkChanges() {
    if (saveNameBtn) {
      const nameChanged = nameInput && nameInput.value !== base.name;
      saveNameBtn.style.display = nameChanged ? 'inline-block' : 'none';
    }
    if (saveLevelBtn) {
      const levelChanged = levelField && parseInt(levelField.value) !== base.level;
      const radiusChanged = radiusField && parseInt(radiusField.value) !== (base.radius || 1000);
      saveLevelBtn.style.display = (levelChanged || radiusChanged) ? 'inline-block' : 'none';
    }
    if (saveIntervalBtn) {
      const intervalChanged = intervalField && parseInt(intervalField.value) * 1000 !== (base.callInterval || 60000);
      saveIntervalBtn.style.display = intervalChanged ? 'inline-block' : 'none';
      if (saveIntervalAllBtn) saveIntervalAllBtn.style.display = intervalChanged ? 'inline-block' : 'none';
    }
  }
  if (nameInput) nameInput.addEventListener('input', checkChanges);
  if (levelField) levelField.addEventListener('input', checkChanges);
  if (radiusField) radiusField.addEventListener('input', checkChanges);
  if (intervalField) intervalField.addEventListener('input', checkChanges);
  checkChanges();
}

function closeBasePanel() {
  const modal = document.getElementById('base-modal');
  if (modal) modal.style.display = 'none';
  openBaseId = null;
}

function refreshBasePanel(id) {
  if (openBaseId === id) {
    openBasePanel(id);
  }
}

function openBaseFromList(id) {
  const base = bases.find(b => b.id === id);
  if (!base) return;
  map.panTo([base.lat, base.lng]);
  openBasePanel(id);
}

function saveBaseChanges(id) {
  const base = bases.find(b => b.id === id);
  if (!base) return;
  const name = document.getElementById('base-name-field').value.trim();
  if (bases.some(b => b.id !== id && b.name === name)) {
    showStatus('❌ Такое название уже существует');
    return;
  }
  base.name = name;
  const levelField = document.getElementById('base-level-field');
  if (levelField) {
    const level = parseInt(levelField.value) || 1;
    base.level = level;
  }
  const radiusField = document.getElementById('base-radius-field');
  if (radiusField) {
    const r = parseInt(radiusField.value) || 1000;
    base.radius = r;
  }
  saveBases();
  refreshBasePanel(id);
  showStatus('✅ Здание обновлено');
}

function saveCallInterval(id, applyAll = false) {
  const field = document.getElementById('call-interval-field');
  if (!field) return;
  const interval = Math.max(5, parseInt(field.value) || 60) * 1000;
  if (applyAll) {
    bases.forEach(b => {
      if (b.type === 'Диспетчерский пункт') {
        b.callInterval = interval;
        if (b.active) startDispatcher(b);
      }
    });
  } else {
    const base = bases.find(b => b.id === id);
    if (!base) return;
    base.callInterval = interval;
    if (base.type === 'Диспетчерский пункт' && base.active) startDispatcher(base);
  }
  saveBases();
  refreshBasePanel(id);
  showStatus(applyAll ? '✅ Интервал обновлен для всех' : '✅ Интервал обновлен');
}

function startMoveBase(id) {
  movingBaseId = id;
  closeBasePanel();
  showMapStatus('🖱 Кликните на карту для нового положения здания');
  map.getContainer().style.cursor = 'crosshair';
  showDispatchZones();
}

function startZoneEdit(id) {
  zoneEdit.baseId = id;
  zoneEdit.points = [];
  if (zoneEdit.poly) { map.removeLayer(zoneEdit.poly); zoneEdit.poly = null; }
  zoneEdit.markers.forEach(m => map.removeLayer(m));
  zoneEdit.markers = [];
  const base = bases.find(b => b.id === id);
  if (base) {
    if (Array.isArray(base.zone) && base.zone.length >= 3) {
      zoneEdit.points = base.zone.map(p => p.slice());
    } else {
      zoneEdit.points = circleToPolygon([base.lat, base.lng], base.radius || 1000);
    }
  }
  drawZoneEdit();
  closeBasePanel();
  showMapStatus('🖱 Кликайте по карте для добавления точек. Используйте меню для сохранения или отмены.');
  map.getContainer().style.cursor = 'crosshair';
  showDispatchZones(id);
  setZoneEditOpacity(true, id);
  showZoneEditMenu();
}

function finishZoneEdit(save) {
  if (!zoneEdit.baseId) return;
  if (save && zoneEdit.points.length >= 3) {
    const smoothed = smoothPolygon(zoneEdit.points);
    const base = bases.find(b => b.id === zoneEdit.baseId);
    if (base && !pointInPolygon([base.lat, base.lng], smoothed)) {
      showStatus('❌ Диспетчерский пункт должен входить в зону');
      return;
    }
    if (base) base.zone = smoothed;
  } else if (save) {
    // not enough points to form a polygon
    showStatus('❌ Нужно минимум 3 точки');
    return;
  }
  hideDispatchZones();
  if (zoneEdit.poly) { map.removeLayer(zoneEdit.poly); zoneEdit.poly = null; }
  zoneEdit.markers.forEach(m => map.removeLayer(m));
  zoneEdit.markers = [];
  zoneEdit.baseId = null;
  zoneEdit.points = [];
  hideMapStatus();
  hideZoneEditMenu();
  setZoneEditOpacity(false);
  map.getContainer().style.cursor = '';
  if (save) {
    updateBaseLocks();
    saveBases();
    showStatus('✅ Зона сохранена');
  }
}

async function sellBase(id) {
  if (!confirm('Продать здание?')) return;
  const base = bases.find(b => b.id === id);
  if (!base) return;
  if (!base.vehicles.every(v => isVehicleInBase(v, base))) {
    showStatus('❌ Нельзя продать здание, пока его машины находятся в пути');
    return;
  }
  const salePrice = Math.floor((baseCosts[base.type] || 0) * 0.8);
  balance = Number(balance) + salePrice;
  await saveBalance(salePrice, 'Продажа здания');
  removeBaseById(id, false);
  closeBasePanel();
  showStatus(`💰 Здание продано за ${salePrice}₽`);
}

async function buyVehicle(baseId, vtype) {
  if (actionLock) return;
  actionLock = true;
  try {
    const base = bases.find(b => b.id === baseId);
  if (!base) return;
  if (!vtype) return;
  const option = (vehicleOptions[base.type] || []).find(o => o.type === vtype);
  if (!option) return;
  if (base.vehicles.length >= base.level * 3) {
    showStatus('❌ Нет свободных мест для машин');
    return;
  }
  if (balance < option.cost) {
    showStatus('❌ Недостаточно средств');
    return;
  }
  balance -= option.cost;
  await saveBalance(-option.cost, `Покупка ${option.name}`);
  base.vehicles.push({
    id: 'veh-' + Math.random().toString(36).substr(2, 9),
    type: option.type,
    name: option.name,
    emoji: option.emoji,
    speed: option.speed,
    mileage: 0,
    condition: 100,
    status: 'idle',
    lat: base.lat,
    lng: base.lng
  });
  saveBases();
  openBasePanel(baseId);
  showStatus(`🚗 Куплена машина: ${option.name}`);
  } finally {
    actionLock = false;
  }
}

async function buyVehicles(baseId, vtype, count) {
  if (actionLock) return false;
  actionLock = true;
  try {
    const base = bases.find(b => b.id === baseId);
    if (!base) return false;
  if (!vtype) return false;
  count = parseInt(count, 10);
  if (!count || count <= 0) return false;
  const option = (vehicleOptions[base.type] || []).find(o => o.type === vtype);
  if (!option) return false;
  const freeSlots = base.level * 3 - base.vehicles.length;
  if (count > freeSlots) {
    showStatus('❌ Нет свободных мест для машин');
    return false;
  }
  const totalCost = option.cost * count;
  if (balance < totalCost) {
    showStatus('❌ Недостаточно средств');
    return false;
  }
  balance -= totalCost;
  await saveBalance(-totalCost, `Покупка ${option.name} x${count}`);
  for (let i = 0; i < count; i++) {
    base.vehicles.push({
      id: 'veh-' + Math.random().toString(36).substr(2, 9),
      type: option.type,
      name: option.name,
      emoji: option.emoji,
      speed: option.speed,
      mileage: 0,
      condition: 100,
      status: 'idle',
      lat: base.lat,
      lng: base.lng
    });
  }
  saveBases();
  openBasePanel(baseId);
  showStatus(`🚗 Куплено машин: ${option.name} x${count}`);
  return true;
  } finally {
    actionLock = false;
  }
}

async function sellVehicle(baseId, vehicleId) {
  if (!confirm('Продать машину?')) return;
  const base = bases.find(b => b.id === baseId);
  if (!base) return;
  const index = base.vehicles.findIndex(v => v.id === vehicleId);
  if (index === -1) return;
  const vehicle = base.vehicles[index];
  if (!isVehicleInBase(vehicle, base)) {
    showStatus('❌ Нельзя продать машину, пока она находится в пути');
    return;
  }
  const opt = (vehicleOptions[base.type] || []).find(o => o.type === vehicle.type);
  const salePrice = opt ? Math.floor(opt.cost * 0.8) : 0;
  balance = Number(balance) + salePrice;
  await saveBalance(salePrice, `Продажа ${vehicle.name}`);
  if (vehicle.marker) map.removeLayer(vehicle.marker);
  if (vehicle.polyline) map.removeLayer(vehicle.polyline);
  base.vehicles.splice(index, 1);
  saveBases();
  openBasePanel(baseId);
  showStatus(`💰 Машина продана за ${salePrice}₽`);
}


// Очистка всех баз
function clearAllBases() {
  if (!confirm("Удалить все здания?")) return;

  // Удалить маркеры с карты
  bases.forEach(base => {
    map.removeLayer(base.marker);
    if (base.type === 'Диспетчерский пункт') stopDispatcher(base.id);
  });

  // Очистить массив и сохранить
  bases = [];
  saveGameData();
}

// Кнопка: активировать режим добавления здания
function manualAddBase() {
  addingBaseMode = true;
  document.getElementById('base-type-select').style.display = 'block';
  document.getElementById('add-base-btn').style.display = 'none';
  showMapStatus("🖱 Выберите тип здания или отмените строительство");
  map.getContainer().style.cursor = 'crosshair';
  showDispatchZones();
}
function cancelAddBase() {
  addingBaseMode = false;
  document.getElementById('base-type-select').style.display = 'none';
  document.getElementById('add-base-btn').style.display = 'inline-block';
  hideMapStatus();
  map.getContainer().style.cursor = '';
  hideDispatchZones();
  showStatus("❌ Строительство здания отменено");
}

// Клик по карте — добавить базу
map.on('click', async e => {
  if (zoneEdit.baseId) {
    zoneEdit.points.push([e.latlng.lat, e.latlng.lng]);
    drawZoneEdit();
    return;
  }
  if (movingBaseId) {
    const base = bases.find(b => b.id === movingBaseId);
    if (base) {
      const newLat = e.latlng.lat;
      const newLng = e.latlng.lng;
      if (base.type !== 'Диспетчерский пункт') {
        const ok = bases.some(d => d.type === 'Диспетчерский пункт' && isPointInZone([newLat, newLng], d));
        if (!ok) {
          showStatus('❌ Здание можно перемещать только в зоне диспетчерского пункта');
          return;
        }
      } else if (Array.isArray(base.zone) && base.zone.length >= 3 && !pointInPolygon([newLat, newLng], base.zone)) {
        if (!confirm('⚠️ Перемещение за пределы зоны сбросит её. Продолжить?')) {
          return;
        }
        base.zone = null;
      }
      base.lat = newLat;
      base.lng = newLng;
    }
    movingBaseId = null;
    map.getContainer().style.cursor = '';
    hideMapStatus();
    hideDispatchZones();
    updateBaseLocks();
    saveBases();
    showStatus('✅ Здание перемещено');
    return;
  }

  if (!addingBaseMode || !window.selectedBaseType) return;

  addingBaseMode = false; // предотвращаем повторные клики
  const { lat, lng } = e.latlng;

  let allowed = true;
  if (window.selectedBaseType !== 'Диспетчерский пункт') {
    allowed = bases.some(b => b.type === 'Диспетчерский пункт' && isPointInZone([lat, lng], b));
    if (!allowed) {
      showStatus('❌ Здание можно строить только в зоне диспетчерского пункта');
      addingBaseMode = true;
      document.getElementById('base-type-select').style.display = 'block';
      document.getElementById('add-base-btn').style.display = 'none';
      return;
    }
  }

  const added = await addBase(lat, lng, null, window.selectedBaseType);

  window.selectedBaseType = null;
  document.getElementById('base-type-select').style.display = 'none';
  document.getElementById('add-base-btn').style.display = 'inline-block';
  map.getContainer().style.cursor = '';
  hideMapStatus();
  hideDispatchZones();

  if (!added) {
    // если не получилось добавить (например, недостаточно денег) - возвращаем режим
    addingBaseMode = true;
    document.getElementById('base-type-select').style.display = 'block';
    document.getElementById('add-base-btn').style.display = 'none';
    showDispatchZones();
  }
});

function showStatus(message) {
  const container = document.getElementById('notification-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'notification';
  el.textContent = message;
  container.prepend(el);
  while (container.childElementCount > 5) {
    container.lastElementChild.remove();
  }
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 400);
  }, 6000);
}

function showMapStatus(text) {
  const el = document.getElementById('map-status');
  el.innerHTML = text; // ← используем innerHTML
  el.style.display = 'block';
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Радиус Земли в метрах
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(m) {
  return m >= 1000 ? (m / 1000).toFixed(1) + ' км' : Math.round(m) + ' м';
}

// Примерная оценка времени в пути (в миллисекундах)
function estimateTravelTime(distMeters, speedKmh = 40) {
  const speed = speedKmh * 1000 / 3600; // м/c
  return distMeters / speed * 1000;
}

function pointInPolygon(point, polygon) {
  let x = point[1], y = point[0];
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0];
    const xj = polygon[j][1], yj = polygon[j][0];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInZone(point, base) {
  if (Array.isArray(base.zone) && base.zone.length >= 3) {
    return pointInPolygon(point, base.zone);
  }
  return getDistance(point[0], point[1], base.lat, base.lng) <= (base.radius || 0);
}

function updateBaseLocks() {
  bases.forEach(b => {
    if (b.type === 'Диспетчерский пункт') { b.locked = false; return; }
    const ok = bases.some(d => d.type === 'Диспетчерский пункт' && isPointInZone([b.lat, b.lng], d));
    b.locked = !ok;
  });
  if (openBaseId) refreshBasePanel(openBaseId);
}

function smoothPolygon(points, iterations = 2) {
  let pts = points.slice();
  for (let k = 0; k < iterations; k++) {
    const newPts = [];
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % pts.length];
      const q = [0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]];
      const r = [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]];
      newPts.push(q, r);
    }
    pts = newPts;
  }
  return pts;
}

function circleToPolygon(center, radius, points = 16) {
  const res = [];
  const d = radius / 111000;
  for (let i = 0; i < points; i++) {
    const ang = 2 * Math.PI * i / points;
    const lat = center[0] + d * Math.sin(ang);
    const lng = center[1] + (d * Math.cos(ang)) / Math.cos(center[0] * Math.PI / 180);
    res.push([lat, lng]);
  }
  return res;
}

function drawZoneEdit() {
  if (!zoneEdit.baseId) return;
  if (zoneEdit.poly) {
    zoneEdit.poly.setLatLngs(zoneEdit.points);
  } else {
    zoneEdit.poly = L.polygon(zoneEdit.points, { color: 'green' }).addTo(map);
  }
  zoneEdit.markers.forEach(m => map.removeLayer(m));
  zoneEdit.markers = zoneEdit.points.map((pt, idx) => {
    const m = L.marker(pt, { draggable: true, icon: L.divIcon({ className: 'zone-handle' }) }).addTo(map);
    m.on('drag', e => {
      zoneEdit.points[idx] = [e.latlng.lat, e.latlng.lng];
      if (zoneEdit.poly) zoneEdit.poly.setLatLngs(zoneEdit.points);
    });
    m.on('contextmenu', e => {
      e.originalEvent.preventDefault();
      e.originalEvent.stopPropagation();
      zoneEdit.points.splice(idx, 1);
      drawZoneEdit();
    });
    return m;
  });
}

function densifyRoute(route, stepMeters = 1) {
  if (!route || route.length < 2) return route;
  const result = [];
  for (let i = 0; i < route.length - 1; i++) {
    const [lat1, lng1] = route[i];
    const [lat2, lng2] = route[i + 1];
    result.push([lat1, lng1]);
    const dist = getDistance(lat1, lng1, lat2, lng2);
    const steps = Math.max(1, Math.floor(dist / stepMeters));
    for (let j = 1; j < steps; j++) {
      const t = j / steps;
      result.push([lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t]);
    }
  }
  result.push(route[route.length - 1]);
  return result;
}

function computeRouteDistance(route) {
  if (!route || route.length < 2) return 0;
  let dist = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const [lat1, lng1] = route[i];
    const [lat2, lng2] = route[i + 1];
    dist += getDistance(lat1, lng1, lat2, lng2);
  }
  return dist;
}

function getPointAtProgress(route, fraction) {
  if (!route || route.length < 2) return route ? route[0] : [0, 0];
  const total = computeRouteDistance(route);
  let target = total * fraction;
  for (let i = 0; i < route.length - 1; i++) {
    const [lat1, lng1] = route[i];
    const [lat2, lng2] = route[i + 1];
    const seg = getDistance(lat1, lng1, lat2, lng2);
    if (target <= seg) {
      const t = seg ? target / seg : 0;
      return [lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t];
    }
    target -= seg;
  }
  return route[route.length - 1];
}

function applyOfflineProgress(deltaMs) {
  if (!deltaMs) return;
  bases.forEach(base => {
    base.vehicles.forEach(v => {
      if (!v.route || v.route.length < 2) return;
      if (!['enroute', 'return', 'transport'].includes(v.status)) return;
      const speed = (v.speed || 40) * 1000 / 3600;
      const total = computeRouteDistance(v.route);
      const startFrac = (v.routeProgress || 0) / 100;
      const remainDist = total * (1 - startFrac);
      const travelMs = remainDist / speed * 1000;
      let endFrac;
      if (deltaMs >= travelMs) {
        endFrac = 1;
      } else {
        endFrac = startFrac + (deltaMs / travelMs) * (1 - startFrac);
      }
      const [lat, lng] = getPointAtProgress(v.route, endFrac);
      v.lat = lat;
      v.lng = lng;
      v.routeProgress = endFrac * 100;
      if (endFrac >= 1) {
        v.route = null;
        v.status = v.status === 'enroute' ? 'onscene' : 'idle';
      }
    });
  });

  const now = Date.now();
  callMarkers.forEach(call => {
    if (call.progress >= 100) return;
    if (!call.penalized && now - call.timestamp > callTimeout) {
      call.penalized = true;
      call.penalty = 5;
      rating = Math.max(0, rating - call.penalty);
      addRatingHistory(-call.penalty, 'Просроченный вызов');
    }
    if (hasAllRequiredOnScene(call)) {
      call.workTime = (call.workTime || 0) + deltaMs;
      const duration = (call.duration || 60) * 1000;
      const baseProg = typeof call.preProgress === 'number' ? call.preProgress : (call.progress || 0);
      const add = (call.workTime / duration) * (100 - baseProg);
      call.progress = Math.min(100, baseProg + add);
      if (call.progress >= 100) {
        call.progress = 100;
      }
    }
  });
}


function animateRoute(vehicle, route, onFinish, startProgress = 0) {
  if (!route || route.length < 2) {
    if (onFinish) onFinish();
    return;
  }

  const speed = (vehicle.speed || 40) * 1000 / 3600;
  let segIdx = 0;
  let segProgress = 0;
  const totalDistance = computeRouteDistance(route);
  let traveled = totalDistance * startProgress;
  let lastTime = Date.now();

  // Determine starting segment and offset if resuming mid-route
  if (startProgress > 0) {
    let remaining = totalDistance * startProgress;
    for (let i = 0; i < route.length - 1; i++) {
      const segDist = getDistance(route[i][0], route[i][1], route[i + 1][0], route[i + 1][1]);
      if (remaining > segDist) {
        remaining -= segDist;
        segIdx++;
      } else {
        segProgress = remaining;
        break;
      }
    }
    const [sLat, sLng] = getPointAtProgress(route, startProgress);
    vehicle.lat = sLat;
    vehicle.lng = sLng;
    vehicle.marker?.setLatLng([sLat, sLng]);
    if (vehicle.polyline) {
      const remainingRoute = route.slice(segIdx);
      remainingRoute[0] = [sLat, sLng];
      vehicle.polyline.setLatLngs(remainingRoute);
    }
  }

  let prevLat = vehicle.lat;
  let prevLng = vehicle.lng;
  vehicle.route = route.slice();
  vehicle.routeProgress = startProgress * 100;

  function finish() {
    const dest = route[route.length - 1];
    if (!dest) return;
    vehicle.marker?.setLatLng(dest);
    vehicle.lat = dest[0];
    vehicle.lng = dest[1];
    if (vehicle.polyline) {
      try { map.removeLayer(vehicle.polyline); } catch {}
      vehicle.polyline = null;
    }
    vehicle.moveTimer = null;
    vehicle.route = null;
    vehicle.routeProgress = 100;
    refreshCallMenu(vehicle.callId);
    if (typeof onFinish === 'function') {
      try { onFinish(); } catch (e) { console.warn('⚠️ onFinish вызвал ошибку:', e); }
    }
  }

  function step() {
    while (
      segIdx < route.length - 1 &&
      getDistance(route[segIdx][0], route[segIdx][1], route[segIdx + 1][0], route[segIdx + 1][1]) === 0
    ) {
      segIdx++;
    }
    if (segIdx >= route.length - 1) { finish(); return; }

    const now = Date.now();
    let distToMove = speed * ((now - lastTime) / 1000);
    lastTime = now;

    while (distToMove > 0 && segIdx < route.length - 1) {
      const [lat1, lng1] = route[segIdx];
      const [lat2, lng2] = route[segIdx + 1];
      const segDist = getDistance(lat1, lng1, lat2, lng2);
      const remaining = segDist - segProgress;
      if (distToMove >= remaining) {
        segIdx++;
        segProgress = 0;
        distToMove -= remaining;
      } else {
        segProgress += distToMove;
        distToMove = 0;
      }
    }

    if (segIdx >= route.length - 1) { finish(); return; }

    const [lat1, lng1] = route[segIdx];
    const [lat2, lng2] = route[segIdx + 1];
    const segDist = getDistance(lat1, lng1, lat2, lng2);
    const ratio = segDist ? segProgress / segDist : 1;
    const lat = lat1 + (lat2 - lat1) * ratio;
    const lng = lng1 + (lng2 - lng1) * ratio;
    const moved = getDistance(prevLat, prevLng, lat, lng);
    vehicle.mileage = (vehicle.mileage || 0) + moved / 1000;
    vehicle.condition = Math.max(0, Math.round((vehicle.condition || 100) - moved / 1000 * 0.05));
    traveled += moved;
    vehicle.routeProgress = totalDistance > 0 ? Math.min(100, traveled / totalDistance * 100) : 100;
    refreshCallMenu(vehicle.callId);
    prevLat = lat;
    prevLng = lng;

    vehicle.marker.setLatLng([lat, lng]);
    vehicle.lat = lat;
    vehicle.lng = lng;
    saveBasesThrottled();

    if (vehicle.polyline) {
      const remainingRoute = route.slice(segIdx);
      remainingRoute[0] = [lat, lng];
      vehicle.polyline.setLatLngs(remainingRoute);
    }

    vehicle.moveTimer = setTimeout(step, 50);
  }

  step();
}



function hideMapStatus() {
  const el = document.getElementById('map-status');
  el.textContent = '';
  el.style.display = 'none';
}

function showDispatchZones(excludeId = null) {
  hideDispatchZones();
  bases.filter(b => b.type === 'Диспетчерский пункт' && b.id !== excludeId).forEach(b => {
    let shape;
    if (Array.isArray(b.zone) && b.zone.length >= 3) {
      shape = L.polygon(b.zone, {
        color: 'green',
        dashArray: '4',
        fillOpacity: 0.05
      }).addTo(map);
    } else {
      shape = L.circle([b.lat, b.lng], {
        radius: b.radius || 1000,
        color: 'green',
        dashArray: '4',
        fillOpacity: 0.05
      }).addTo(map);
    }
    addModeCircles.push(shape);
  });
}

function hideDispatchZones() {
  addModeCircles.forEach(c => map.removeLayer(c));
  addModeCircles = [];
}

async function getRoute(start, end) {
  const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    }
  } catch (e) {
    console.error('Route fetch failed', e);
  }
  return [[start.lat, start.lng], [end.lat, end.lng]];
}

map.on('contextmenu', (e) => {
  if (zoneEdit.baseId) {
    finishZoneEdit(false);
    return;
  }
  if (addingBaseMode) {
    cancelAddBase();
    return;
  }
  if (movingBaseId) {
    movingBaseId = null;
    map.getContainer().style.cursor = '';
    hideMapStatus();
    hideDispatchZones();
  }
});


// Выбор типа базы
function getSelectedBaseType() {
  return selectedBaseType || 'Полицейский участок';
}


const callMarkers = []; // массив вызовов
function isLocationOccupied(lat, lng) {
  return callMarkers.some(call =>
    call.lat.toFixed(5) === lat.toFixed(5) &&
    call.lng.toFixed(5) === lng.toFixed(5)
  );
}

async function generateRandomCall(customBounds = null, specificType = null, dispatcherId = null) {
  if (isGeneratingCall) return;
  isGeneratingCall = true;
  const btn = document.getElementById('generate-call-btn');
  if (btn) btn.disabled = true;
  try {
    if (Object.keys(callIcons).length === 0) {
      await loadCallTypes();
      if (Object.keys(callIcons).length === 0) {
        showStatus('❌ Не удалось загрузить типы вызовов');
        return;
      }
    }
    const bounds = customBounds || map.getBounds();
  const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;

  const query = `
    [out:json][timeout:25];
    (
      nwr["building"](${bbox});
      nwr["highway"](${bbox});
      nwr["amenity"="school"](${bbox});
      nwr["amenity"="hospital"](${bbox});
      nwr["amenity"="clinic"](${bbox});
      nwr["amenity"="playground"](${bbox});
      nwr["amenity"="university"](${bbox});
      nwr["amenity"="police"](${bbox});
      nwr["leisure"="park"](${bbox});
      nwr["natural"="wood"](${bbox});
      nwr["landuse"="forest"](${bbox});
      nwr["landuse"="industrial"](${bbox});
      nwr["shop"](${bbox});
      nwr["bridge"](${bbox});
    );
    out center;
  `;

  let response;
  try {
    response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    if (!response.ok) {
      showStatus('❌ Ошибка ответа Overpass API');
      return;
    }
  } catch (err) {
    showStatus("❌ Ошибка подключения к Overpass API");
    return;
  }

  let json;
  try {
    json = await response.json();
  } catch (e) {
    showStatus('❌ Некорректный ответ Overpass API');
    return;
  }
  const elements = json.elements.filter(e => (e.lat || (e.center && e.center.lat)) && (e.lon || (e.center && e.center.lon)) && e.tags);

  // Соберём подходящие точки под каждый тип вызова
  const validCalls = [];
  const types = specificType && callIcons[specificType]
    ? { [specificType]: callIcons[specificType] }
    : callIcons;

  if (specificType && !callIcons[specificType]) {
    showStatus('❌ Неизвестный тип вызова');
    return;
  }

  for (const [type, info] of Object.entries(types)) {
    for (const tagQuery of info.match) {
      const [key, value] = tagQuery.split('=');
      const matches = elements.filter(el =>
        value ? el.tags[key] === value : el.tags.hasOwnProperty(key)
      );

      for (const el of matches) {
        validCalls.push({
          type,
          emoji: info.emoji,
          text: info.text,
          lat: el.lat || (el.center && el.center.lat),
          lng: el.lon || (el.center && el.center.lon)
        });
      }
    }
  }

  if (validCalls.length === 0) {
  showStatus("⚠️ Нет подходящих объектов на карте");
    return;
  }

  // Перемешаем массив, чтобы попытки были случайными
  validCalls.sort(() => Math.random() - 0.5);

  for (const call of validCalls) {
    const address = await getAddressFromCoords(call.lat, call.lng);

    const duplicate = callMarkers.some(c => c.address === address);
    if (duplicate) continue;

    const marker = L.marker([call.lat, call.lng], {
      icon: L.divIcon({
        className: 'call-marker',
        html: `<div style="font-size: 20px;">${call.emoji}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    }).addTo(map)
      .bindPopup(`<strong>Вызов:</strong> ${call.text}<br><strong>Адрес:</strong> ${address}`);

    marker.on('click', () => openCallMenu(id));
    marker.on('mouseover', () => marker.openPopup());
    marker.on('mouseout', () => marker.closePopup());

    const id = 'call-' + Math.random().toString(36).substr(2, 9);
    const req = Array.isArray(callIcons[call.type].vehicles) ? callIcons[call.type].vehicles : [];
    const duration = (callIcons[call.type] && callIcons[call.type].duration) || 60;
    const callObj = {
      id,
      type: call.type,
      lat: call.lat,
      lng: call.lng,
      emoji: call.emoji,
      text: call.text,
      address,
      timestamp: Date.now(),
      marker,
      dispatcherId,
      requiredVehicles: sortVehicleTypes(req),
      fake: Math.random() < 0.1,
      penalized: false,
      penalty: 0,
      assigned: false,
      assignedVehicles: [],
      duration,
      workTime: 0,
      preProgress: 0,
      lastUpdate: Date.now(),
      progress: 0
    };

    callMarkers.push(callObj);
    if (zoneEdit.baseId) {
      callObj.marker.setOpacity(0.3);
    }

    saveCalls();
    updateCallListUI();
    showStatus(`🚨 Новый вызов: ${call.text}`);
    return;
  }

  // Если не удалось найти уникальный адрес
  showStatus("⚠️ Все адреса уже задействованы");
  } finally {
    isGeneratingCall = false;
    if (btn) btn.disabled = false;
  }
}

function getDispatcherBounds() {
  return bases
    .filter(b => b.type === 'Диспетчерский пункт')
    .map(b => {
      if (Array.isArray(b.zone) && b.zone.length >= 3) {
        const poly = L.polygon(b.zone);
        const bb = poly.getBounds();
        return {
          id: b.id,
          getSouth: () => bb.getSouth(),
          getWest: () => bb.getWest(),
          getNorth: () => bb.getNorth(),
          getEast: () => bb.getEast()
        };
      }
      const deg = (b.radius || 1000) / 111000;
      return {
        id: b.id,
        getSouth: () => b.lat - deg,
        getWest: () => b.lng - deg,
        getNorth: () => b.lat + deg,
        getEast: () => b.lng + deg
      };
    });
}

async function generateCallTester() {
  const zones = getDispatcherBounds();
  if (zones.length === 0) {
    showStatus('❌ Нет диспетчерских пунктов');
    return;
  }
  const select = document.getElementById('call-type-select');
  const type = select && select.value ? select.value : null;
  const zone = zones[Math.floor(Math.random() * zones.length)];
  await generateRandomCall(zone, type, zone.id);
}

function startDispatcher(base) {
  stopDispatcher(base.id);
  const interval = base.callInterval || 60000;
  dispatcherIntervals[base.id] = setInterval(() => {
    let bounds;
    if (Array.isArray(base.zone) && base.zone.length >= 3) {
      const poly = L.polygon(base.zone);
      const b = poly.getBounds();
      bounds = {
        getSouth: () => b.getSouth(),
        getWest: () => b.getWest(),
        getNorth: () => b.getNorth(),
        getEast: () => b.getEast()
      };
    } else {
      const deg = (base.radius || 1000) / 111000;
      bounds = {
        getSouth: () => base.lat - deg,
        getWest: () => base.lng - deg,
        getNorth: () => base.lat + deg,
        getEast: () => base.lng + deg
      };
    }
    generateRandomCall(bounds, null, base.id);
  }, interval);
}

function stopDispatcher(id) {
  if (dispatcherIntervals[id]) {
    clearInterval(dispatcherIntervals[id]);
    delete dispatcherIntervals[id];
  }
}

function toggleDispatcher(id) {
  const base = bases.find(b => b.id === id);
  if (!base) return;
  if (base.active) {
    stopDispatcher(id);
    base.active = false;
    showStatus('⏹ Диспетчерский пункт остановлен');
  } else {
    startDispatcher(base);
    base.active = true;
    showStatus('▶ Диспетчерский пункт запущен');
  }
  saveBases();
  refreshBasePanel(id);
}

function attachBaseHoverEvents(base) {
  if (!base.marker) return;
  if (!base.marker.getTooltip()) {
    base.marker.bindTooltip(base.name, { direction: 'top', offset: [0, -4] });
  }
  base.marker.on('mouseover', () => {
    base.marker.openTooltip();
    if (base.type === 'Диспетчерский пункт') {
      if (Array.isArray(base.zone) && base.zone.length >= 3) {
        base.callCircle = L.polygon(base.zone, {
          color: 'red',
          dashArray: '4',
          fillOpacity: 0.05
        }).addTo(map);
      } else {
        base.callCircle = L.circle([base.lat, base.lng], {
          radius: base.radius || 1000,
          color: 'red',
          dashArray: '4',
          fillOpacity: 0.05
        }).addTo(map);
      }
    }
  });
  base.marker.on('mouseout', () => {
    if (base.callCircle) { map.removeLayer(base.callCircle); base.callCircle = null; }
    base.marker.closeTooltip();
  });
}




function updateCallListUI() {
  const container = document.getElementById('calllist');
  if (!container) return;

  if (callMarkers.length === 0) {
    container.classList.remove('visible');
    container.innerHTML = '';
    return;
  }

  container.classList.add('visible');
  container.innerHTML = '<h3>Активные вызовы</h3>';

  const sorted = callMarkers.slice();
  sorted.forEach((call, index) => {
    const div = document.createElement('div');
    div.className = `call-entry ${call.type}`;
    const remainingReqs = formatRemainingRequirements(call);
    div.innerHTML = `
      <div><span class="call-icon">${call.emoji}</span><strong class="call-link" onclick="openCallMenu('${call.id}')">${call.text}</strong></div>
      <div>📍 ${call.address}</div><br>
      <div class="call-entry">
        <small>⏱️ Время: ${new Date(call.timestamp).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })}</small><br>
        <small>⏰ Прошло: <span class="elapsed" data-timestamp="${call.timestamp}">0:00</span></small><br>
        <small>⌛ ${call.penalized ? 'Давалось' : 'До штрафа'}: <span class="countdown" data-timestamp="${call.timestamp}">--:--</span></small>
        ${call.requiredVehicles && call.requiredVehicles.length ? `<br><small>🚗 ${remainingReqs ? 'Требуется: ' + remainingReqs : 'Т/с отправлены'}</small>` : ''}
        <div class="progress-container"><div class="progress-bar" data-call="${call.id}" style="width:${call.progress || 0}%"></div></div>
      </div>
      ${call.penalized ? `<div class="penalty">⚠️ Опоздание на вызов: рейтинг снижен на -${call.penalty}</div>` : ''}
      
    `;
    container.appendChild(div);
  });

  // Добавляем кнопку "Завершить все"
  const clearBtn = document.createElement('button');
  clearBtn.className = 'clear-all btn';
  clearBtn.textContent = '❌ Завершить все вызовы';
  clearBtn.onclick = async () => {
    if (confirm("Завершить все вызовы?")) {
      const calls = callMarkers.slice();
      for (const c of calls) {
        await removeCall(c.id);
      }
      showStatus("✅ Все вызовы завершены");
    }
  };
  container.appendChild(clearBtn);
}

const callTimeout = 5 * 60 * 1000;

function checkUnresolvedCalls(now) {
  callMarkers.forEach(call => {
    if (call.penalized) return;
    if (now - call.timestamp > callTimeout) {
      const penalty = 5;
      rating = Math.max(0, rating - penalty);
      call.penalized = true;
      call.penalty = penalty;
      updateRatingUI();
      saveRating(-penalty, 'Просроченный вызов');
      showStatus(`⚠️ Опоздание на вызов: рейтинг снижен на -${penalty}`);
      updateCallListUI();
    }
  });
}

async function completeCall(call) {
  for (const ref of call.assignedVehicles || []) {
    const base = bases.find(b => b.id === ref.baseId);
    const vehicle = base && base.vehicles.find(v => v.id === ref.vehicleId);
    if (vehicle) {
      const route = await getRoute({ lat: call.lat, lng: call.lng }, { lat: base.lat, lng: base.lng });
      const smooth = densifyRoute(route);
      returnToBase(base, vehicle, smooth);
    }
  }
  removeCall(call.id, true);
}

function updateCallProgress() {
  const toComplete = [];
  let changed = false;
  const now = Date.now();
  callMarkers.forEach(call => {
    if (call.progress >= 100) return;
    if (!call.lastUpdate) call.lastUpdate = now;
    const allReq = hasAllRequiredOnScene(call);
    const prev = call.progress || 0;
    if (allReq) {
      if (call.preProgress === undefined) {
        call.preProgress = call.progress || 0;
      }
      call.workTime = (call.workTime || 0) + (now - call.lastUpdate);
      const duration = (call.duration || 60) * 1000;
      const after = (call.workTime / duration) * (100 - call.preProgress);
      call.progress = Math.min(100, call.preProgress + after);
      if (call.progress >= 100) toComplete.push(call);
    } else {
      let inc = 0;
      bases.forEach(base => {
        base.vehicles.forEach(v => {
          if (v.callId === call.id && v.status === 'onscene') {
            const cat = vehicleCategory[v.type];
            inc += progressRates[cat] || 0;
          }
        });
      });
      if (inc > 0 && call.progress < 30) {
        call.progress = Math.min(30, call.progress + inc);
      }
      call.workTime = 0;
      delete call.preProgress;
    }
    if (call.progress !== prev) {
      changed = true;
      const bar = document.querySelector(`.progress-bar[data-call="${call.id}"]`);
      if (bar) bar.style.width = call.progress + '%';
      const modal = document.getElementById('call-modal');
      const cont = document.getElementById('call-content');
      if (modal && cont && modal.style.display === 'block' && cont.dataset.callId === call.id) {
        openCallMenu(call.id);
      }
    }
    call.lastUpdate = now;
  });
  if (toComplete.length) {
    toComplete.forEach(c => completeCall(c));
  }
  if (changed) {
    saveCallsThrottled();
    updateCallListUI();
  }
}

function sanitizeServiceStation(st) {
  if (!st) return null;
  const mech = st.mechanic ? {
    lat: st.mechanic.lat,
    lng: st.mechanic.lng,
    status: st.mechanic.status,
    route: Array.isArray(st.mechanic.route) ? st.mechanic.route : null
  } : null;
  return {
    level: st.level,
    master: st.master,
    towTruck: !!st.towTruck,
    mechanic: mech,
    hiring: !!st.hiring
  };
}

function updateMoscowTime() {
  const now = new Date();

  // Московское время: UTC+3 без учёта перехода на летнее время
  // Чтобы получить текущее время по МСК, можно взять UTC-время и прибавить 3 часа
  const utc = now.getTime() + now.getTimezoneOffset() * 60000; // время в UTC в миллисекундах
  const moscowOffset = 3 * 60 * 60000; // +3 часа в миллисекундах
  const moscowTime = new Date(utc + moscowOffset);

  // Форматируем время с ведущими нулями
  const hours = moscowTime.getHours().toString().padStart(2, '0');
  const minutes = moscowTime.getMinutes().toString().padStart(2, '0');
  const seconds = moscowTime.getSeconds().toString().padStart(2, '0');

  const timeStr = `${hours}:${minutes}:${seconds}`;

  const timeEl = document.getElementById('moscow-time');
  if (timeEl) {
    timeEl.textContent = `${timeStr}`;
  }
}
setInterval(updateMoscowTime, 1000);
updateMoscowTime(); // сразу показать время без задержки



function zoomToCall(id) {
  const call = callMarkers.find(c => c.id === id);
  if (call && call.marker) {
    map.setView([call.lat, call.lng], 17);
    call.marker.openPopup();
  }
}

function selectBaseType(type) {
  if (!addingBaseMode) return;

  const cost = baseCosts[type] || 0;
  showMapStatus(`🖱 Кликните на карту, чтобы построить здание типа: ${type} (стоимость ${cost}₽)`);
  map.getContainer().style.cursor = 'crosshair';

  // Записываем выбранный тип в переменную, чтобы использовать при клике на карте
  window.selectedBaseType = type;
}

function getRequiredBaseType(callType, requiredVehicles = []) {
  const req = Array.isArray(requiredVehicles) ? requiredVehicles : [];
  const fireTypes = ['fire_truck', 'ladder_truck', 'tanker_truck', 'aerial_platform', 'special_fire', 'foam_truck'];
  const medicalTypes = ['ambulance', 'rescue_ambulance', 'psp', 'msp'];
  const policeTypes = ['patrol', 'swat_van', 'dps_car', 'k9_unit'];
  if (req.some(v => fireTypes.includes(v))) return 'Пожарная часть';
  if (req.some(v => medicalTypes.includes(v))) return 'Больница';
  if (req.some(v => policeTypes.includes(v))) return 'Полицейский участок';
  if (callType.includes('fire')) return 'Пожарная часть';
  if (['medical', 'overdose', 'heart_attack'].some(t => callType.includes(t))) return 'Больница';
  return 'Полицейский участок';
}

function saveCalls() {
  return saveGameData();
}




function loadCalls() {
  updateCallListUI();
}




async function removeCall(id, fromVehicle = false) {
  const index = callMarkers.findIndex(call => call.id === id);
  if (index !== -1) {
    const call = callMarkers[index];
    map.removeLayer(call.marker);
    const wasFake = call.fake;

    // Если вызов был назначен машине и отменён вручную,
    // отправляем транспорт обратно на здание
    if (!fromVehicle && Array.isArray(call.assignedVehicles)) {
      for (const ref of call.assignedVehicles) {
        const base = bases.find(b => b.id === ref.baseId);
        const vehicle = base && base.vehicles.find(v => v.id === ref.vehicleId);
        if (vehicle) {
          if (vehicle.moveTimer) {
            clearTimeout(vehicle.moveTimer);
            vehicle.moveTimer = null;
          }
          if (vehicle.polyline) {
            map.removeLayer(vehicle.polyline);
            vehicle.polyline = null;
          }
          const route = await getRoute({ lat: vehicle.lat, lng: vehicle.lng }, { lat: base.lat, lng: base.lng });
          const smooth = densifyRoute(route);
          returnToBase(base, vehicle, smooth);
        }
      }
    }

    callMarkers.splice(index, 1);
    updateCallListUI();
    await saveCalls();
    if (wasFake) {
      showStatus("⚠️ Вызов оказался ложным");
    } else {
      showStatus("✅ Вызов завершён");
    }
  } else {
    console.warn("❌ Вызов с таким ID не найден:", id);
  }
}

async function dispatchCall(id) {
  const call = callMarkers.find(c => c.id === id);
  if (!call) return;
  const reqCounts = {};
  (call.requiredVehicles || []).forEach(t => { reqCounts[t] = (reqCounts[t] || 0) + 1; });

  const assignedCounts = {};
  (call.assignedVehicles || []).forEach(ref => {
    const base = bases.find(b => b.id === ref.baseId);
    const v = base && base.vehicles.find(x => x.id === ref.vehicleId);
    if (v && v.callId === call.id && ['enroute','onscene'].includes(v.status)) {
      assignedCounts[v.type] = (assignedCounts[v.type] || 0) + 1;
    }
  });

  const dispatched = [];
  const missing = {};
  const selected = new Set();

  for (const [type, count] of Object.entries(reqCounts)) {
    let need = count - (assignedCounts[type] || 0);
    while (need > 0) {
      let best = null;
      bases.forEach(base => {
        if (base.locked) return;
        base.vehicles.forEach(v => {
          if (v.status === 'idle' && v.type === type && !selected.has(v)) {
            const dist = getDistance(base.lat, base.lng, call.lat, call.lng);
            if (!best || dist < best.dist) best = { base, vehicle: v, dist };
          }
        });
      });
      if (best) {
        selected.add(best.vehicle);
        dispatched.push(best);
      } else {
        missing[type] = (missing[type] || 0) + need;
        need = 0;
        break;
      }
      need--;
    }
  }

  if (dispatched.length === 0) {
    showStatus('❌ Нет свободных машин подходящего типа');
    return;
  }

  const missingTypes = Object.keys(missing);
  if (missingTypes.length) {
    const parts = missingTypes.map(t => {
      const name = getVehicleNameByType(t);
      const count = missing[t];
      return count > 1 ? `${name} x${count}` : name;
    });
    showStatus('⚠️ Недостаточно машин: ' + parts.join(', '));
  }

  if (!Array.isArray(call.assignedVehicles)) call.assignedVehicles = [];
  dispatched.forEach(d => {
    call.assignedVehicles.push({ baseId: d.base.id, vehicleId: d.vehicle.id });
  });
  call.assigned = call.assignedVehicles.length > 0;
  saveCalls();
  updateCallListUI();

  const routes = await Promise.all(dispatched.map(d =>
    getRoute({ lat: d.base.lat, lng: d.base.lng }, { lat: call.lat, lng: call.lng })
  ));
  dispatched.forEach((d, idx) => {
    const smoothRoute = densifyRoute(routes[idx]);
    moveVehicle(d.base, d.vehicle, call, smoothRoute);
  });
}

function moveVehicle(base, vehicle, call, route) {
  vehicle.status = 'enroute';
  vehicle.callId = call.id;
  vehicle.route = route.slice();
  const img = getVehicleImage(vehicle.type);
  const html = img ? `<img src="${img}" alt="">` : vehicle.emoji;
  vehicle.marker = L.marker([base.lat, base.lng], {
    icon: L.divIcon({ className: 'vehicle-marker', html, iconSize: [64, 64], iconAnchor: [32, 32] })
  }).addTo(map);
  vehicle.polyline = L.polyline(route, { color: 'blue' }).addTo(map);
  saveBases(true);
  refreshBasePanel(base.id);
  animateRoute(vehicle, route, () => {
    if (vehicle.marker) { map.removeLayer(vehicle.marker); }
    vehicle.marker = null;
    vehicle.lat = call.lat;
    vehicle.lng = call.lng;
    vehicle.status = 'onscene';
    if (vehicle.polyline) { map.removeLayer(vehicle.polyline); vehicle.polyline = null; }
    vehicle.routeProgress = 100;
    saveBases(true);
    refreshBasePanel(base.id);
    refreshCallMenu(call.id);
  });
}

function returnToBase(base, vehicle, route) {
  const transporting = ['ambulance', 'rescue_ambulance', 'psp', 'msp', 'patrol', 'dps_car', 'swat_van', 'k9_unit'];
  vehicle.status = transporting.includes(vehicle.type) ? 'transport' : 'return';
  vehicle.route = route.slice();
  vehicle.routeProgress = 0;
  if (!vehicle.marker) {
    const img = getVehicleImage(vehicle.type);
    const html = img ? `<img src="${img}" alt="">` : vehicle.emoji;
    vehicle.marker = L.marker([vehicle.lat, vehicle.lng], {
      icon: L.divIcon({ className: 'vehicle-marker', html, iconSize: [64, 64], iconAnchor: [32, 32] })
    }).addTo(map);
  }
  // Отрисовываем путь возвращения, если он ещё не создан
  if (!vehicle.polyline) {
    vehicle.polyline = L.polyline(route, { color: 'blue' }).addTo(map);
  }
  animateRoute(vehicle, route, () => {
    if (vehicle.marker) map.removeLayer(vehicle.marker);
    if (vehicle.polyline) map.removeLayer(vehicle.polyline);
    vehicle.status = 'idle';
    vehicle.lat = base.lat;
    vehicle.lng = base.lng;
    vehicle.route = null;
    vehicle.callId = null;
    vehicle.marker = null;
    vehicle.polyline = null;
    vehicle.routeProgress = 100;
    saveBases(true);
    refreshBasePanel(base.id);
  });
}

function setVehicleStatus(baseId, vehicleId, status) {
  if (!window.isAdminView) return;
  const base = bases.find(b => b.id === baseId);
  if (!base) return;
  const vehicle = base.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return;
  vehicle.status = status;
  if (status === 'idle') {
    vehicle.lat = base.lat;
    vehicle.lng = base.lng;
    vehicle.callId = null;
    if (vehicle.marker) { map.removeLayer(vehicle.marker); vehicle.marker = null; }
    if (vehicle.polyline) { map.removeLayer(vehicle.polyline); vehicle.polyline = null; }
  }
  saveBases(true);
  refreshBasePanel(baseId);
}

async function returnVehicle(baseId, vehicleId) {
  const base = bases.find(b => b.id === baseId);
  if (!base) return;
  const vehicle = base.vehicles.find(v => v.id === vehicleId);
  if (!vehicle || isVehicleInBase(vehicle, base)) return;
  if (vehicle.callId) {
    const call = callMarkers.find(c => c.id === vehicle.callId);
    if (call && call.progress < 100) {
      showStatus('❌ Нельзя вернуть машину до завершения вызова');
      return;
    }
  }
  if (vehicle.moveTimer) {
    clearTimeout(vehicle.moveTimer);
    vehicle.moveTimer = null;
  }
  if (vehicle.polyline) { map.removeLayer(vehicle.polyline); vehicle.polyline = null; }
  const route = await getRoute({ lat: vehicle.lat, lng: vehicle.lng }, { lat: base.lat, lng: base.lng });
  const smooth = densifyRoute(route);
  if (vehicle.callId) {
    const call = callMarkers.find(c => c.id === vehicle.callId);
    if (call) {
      call.assigned = false;
      call.assignedVehicles = [];
      saveCalls();
      updateCallListUI();
      refreshCallMenu(call.id);
    }
    vehicle.callId = null;
  }
  returnToBase(base, vehicle, smooth);
}

function forceReturnVehicle(baseId, vehicleId) {
  if (!window.isAdminView) return;
  const base = bases.find(b => b.id === baseId);
  if (!base) return;
  const vehicle = base.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return;
  if (vehicle.marker) { map.removeLayer(vehicle.marker); vehicle.marker = null; }
  if (vehicle.polyline) { map.removeLayer(vehicle.polyline); vehicle.polyline = null; }
  vehicle.status = 'idle';
  vehicle.route = null;
  vehicle.lat = base.lat;
  vehicle.lng = base.lng;
  vehicle.callId = null;
  saveBases(true);
  refreshBasePanel(baseId);
}

async function buyServiceStation(baseId) {
  if (actionLock) return;
  actionLock = true;
  try {
    const base = bases.find(b => b.id === baseId);
    if (!base || base.serviceStation) return;
  if (balance < STO_COST) {
    showStatus('❌ Недостаточно средств');
    return;
  }
  balance -= STO_COST;
  await saveBalance(-STO_COST, `Покупка СТО ${base.name}`);
  base.serviceStation = { level: 1, master: null, towTruck: false, mechanic: null, upgrading: false, hiring: false };
  saveBases();
  openBasePanel(baseId);
    showStatus(`🏗 Построена СТО в ${base.name}`);
  } finally {
    actionLock = false;
  }
}

async function buyServiceStationWithMaster(baseId, masterId) {
  if (actionLock) return;
  actionLock = true;
  try {
    const base = bases.find(b => b.id === baseId);
    if (!base) return;
    const master = MASTER_OPTIONS.find(m => m.id === masterId);
    if (!master) return;

    const hasStation = !!base.serviceStation;
    const hadMaster = hasStation && base.serviceStation.master;
    const totalCost = (hasStation ? 0 : STO_COST) + master.hireCost;

    if (balance < totalCost) {
      showStatus('❌ Недостаточно средств');
      return;
    }

    if (!hasStation) {
      base.serviceStation = { level: 1, master: null, towTruck: false, mechanic: null, upgrading: false, hiring: false };
    } else if (base.serviceStation.hiring) {
      return;
    }

    base.serviceStation.hiring = true;
    refreshBasePanel(baseId);

    balance -= totalCost;
    await saveBalance(-totalCost, `${!hasStation ? 'Покупка СТО и ' : ''}${hadMaster ? 'Смена' : 'Наём'} мастера ${master.name} ${base.name}`);

    base.serviceStation.master = { ...master };
    base.serviceStation.hiring = false;
    saveBases();
    openBasePanel(baseId);

    const msg = !hasStation ? `🏗 Построена СТО и нанят мастер ${master.name}` : (hadMaster ? `👨‍🔧 Сменён мастер ${master.name}` : `👨‍🔧 Нанят мастер ${master.name}`);
    showStatus(msg);
  } finally {
    actionLock = false;
  }
}

async function recallVehicle(baseId, vehicleId) {
  const base = bases.find(b => b.id === baseId);
  if (!base) return;
  const vehicle = base.vehicles.find(v => v.id === vehicleId);
  if (!vehicle || isVehicleInBase(vehicle, base)) return;

  if (vehicle.moveTimer) {
    clearTimeout(vehicle.moveTimer);
    vehicle.moveTimer = null;
  }
  if (vehicle.polyline) { map.removeLayer(vehicle.polyline); vehicle.polyline = null; }

  // Immediately mark vehicle as returning and refresh UI
  const transporting = ['ambulance','rescue_ambulance','psp','msp','patrol','dps_car','swat_van','k9_unit'];
  vehicle.status = transporting.includes(vehicle.type) ? 'transport' : 'return';
  vehicle.routeProgress = 0;
  refreshBasePanel(base.id);

  if (vehicle.callId) {
    const call = callMarkers.find(c => c.id === vehicle.callId);
    if (call) {
      call.assignedVehicles = (call.assignedVehicles || []).filter(ref => !(ref.baseId === base.id && ref.vehicleId === vehicle.id));
      call.assigned = (call.assignedVehicles || []).length > 0;
      saveCalls();
      updateCallListUI();
      refreshCallMenu(call.id);
      const modal = document.getElementById('call-modal');
      const cont = document.getElementById('call-content');
      if (modal && cont && modal.style.display === 'block' && cont.dataset.callId === call.id) {
        openCallMenu(call.id);
      }
    }
    vehicle.callId = null;
  }

  const route = await getRoute({ lat: vehicle.lat, lng: vehicle.lng }, { lat: base.lat, lng: base.lng });
  const smooth = densifyRoute(route);
  returnToBase(base, vehicle, smooth);
}

async function buyTowTruck(baseId) {
  if (actionLock) return;
  actionLock = true;
  try {
    const base = bases.find(b => b.id === baseId);
    if (!base || !base.serviceStation) return;
    if (base.serviceStation.towTruck) return;
    if (balance < TOW_TRUCK_COST) {
      showStatus('❌ Недостаточно средств');
      return;
    }
    balance -= TOW_TRUCK_COST;
    await saveBalance(-TOW_TRUCK_COST, `Покупка эвакуатора ${base.name}`);
    base.serviceStation.towTruck = true;
    if (!base.serviceStation.mechanic) {
      base.serviceStation.mechanic = createMechanic(base);
    }
    saveBases();
    openBasePanel(baseId);
    showStatus('🚚 Куплен эвакуатор');
  } finally {
    actionLock = false;
  }
}

async function serviceVehicle(baseId, vehicleId) {
  const base = bases.find(b => b.id === baseId);
  if (!base || !base.serviceStation || !base.serviceStation.master) return;
  if (base.serviceStation.mechanic && base.serviceStation.mechanic.status !== 'idle') {
    showStatus('Механик на выезде');
    return;
  }
  const vehicle = base.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return;
  const cost = getServiceCost(base);
  if (balance < cost) {
    showStatus('❌ Недостаточно средств');
    return;
  }
  balance -= cost;
  await saveBalance(-cost, `ТО ${vehicle.name}`);
  vehicle.condition = 100;
  saveBases();
  openBasePanel(baseId);
  showStatus(`🔧 Машина ${vehicle.name} обслужена`);
}

async function repairVehicleOnSite(baseId, vehicleId) {
  const base = bases.find(b => b.id === baseId);
  if (!base || !base.serviceStation || !base.serviceStation.master) return;
  if (!base.serviceStation.towTruck) {
    showStatus('❌ Нет эвакуатора');
    return;
  }
  if (base.serviceStation.mechanic && base.serviceStation.mechanic.status !== 'idle') {
    showStatus('Механик уже выехал');
    return;
  }
  const vehicle = base.vehicles.find(v => v.id === vehicleId);
  if (!vehicle || vehicle.condition >= 100) return;
  if (vehicle.moveTimer) {
    clearTimeout(vehicle.moveTimer);
    vehicle.moveTimer = null;
  }
  if (vehicle.polyline) {
    map.removeLayer(vehicle.polyline);
    vehicle.polyline = null;
  }
  vehicle.route = Array.isArray(vehicle.route) ? vehicle.route.slice() : null;
  vehicle.status = 'waiting_tow';
  const distKm = getDistance(base.lat, base.lng, vehicle.lat, vehicle.lng) / 1000;
  const cost = Math.round(ONSITE_REPAIR_BASE + ONSITE_REPAIR_PER_KM * distKm);
  if (balance < cost) {
    showStatus('❌ Недостаточно средств');
    return;
  }
  balance -= cost;
  await saveBalance(-cost, `Выездной ремонт ${vehicle.name}`);
if (!base.serviceStation.mechanic) {
    base.serviceStation.mechanic = createMechanic(base);
  }
  const route = await getRoute({lat: base.lat, lng: base.lng}, {lat: vehicle.lat, lng: vehicle.lng});
  const smooth = densifyRoute(route);
  saveBases();
  refreshBasePanel(baseId);
  showStatus(`🚚 Механик выехал к ${vehicle.name}`);
  moveMechanic(base, base.serviceStation.mechanic, vehicle, smooth);

}

async function hireMaster(baseId, masterId, replace = false) {
  if (actionLock) return;
  actionLock = true;
  try {
    const base = bases.find(b => b.id === baseId);
    if (!base || !base.serviceStation) return;
    if (base.serviceStation.hiring || (!replace && base.serviceStation.master)) return;
    const master = MASTER_OPTIONS.find(m => m.id === masterId);
    if (!master) return;
    if (balance < master.hireCost) {
      showStatus('❌ Недостаточно средств');
      return;
    }
    base.serviceStation.hiring = true;
    refreshBasePanel(baseId);
    balance -= master.hireCost;
    await saveBalance(-master.hireCost, `${replace ? 'Смена' : 'Наём'} мастера ${master.name}`);
    base.serviceStation.master = { ...master };
    base.serviceStation.hiring = false;
    saveBases();
    openBasePanel(baseId);
    showStatus(`👨‍🔧 ${replace ? 'Сменён мастер' : 'Нанят мастер'} ${master.name}`);
  } finally {
    actionLock = false;
  }
}

function changeMaster(baseId, masterId) {
  hireMaster(baseId, masterId, true);
}

function hireMasterSelect(baseId) {
  const select = document.getElementById(`master-select-${baseId}`);
  if (!select) return;
  const masterId = select.value;
  buyServiceStationWithMaster(baseId, masterId);
}

function showMasterSelect(baseId) {
  const container = document.getElementById(`master-action-${baseId}`);
  if (!container) return;
  const base = bases.find(b => b.id === baseId);
  if (!base || !base.serviceStation) return;
  const hasMaster = !!base.serviceStation.master;
  const options = MASTER_OPTIONS
    .filter(m => !hasMaster || m.id !== base.serviceStation.master.id)
    .map(m => `<option value="${m.id}">${m.name} (${m.hireCost}₽, зп ${m.salary}₽)</option>`).join('');
  container.innerHTML = `<select id="master-select-${baseId}">${options}</select> <button onclick="confirmMasterSelect('${baseId}')">${hasMaster ? 'Сменить' : 'Нанять'}</button>`;
}

function confirmMasterSelect(baseId) {
  const select = document.getElementById(`master-select-${baseId}`);
  if (!select) return;
  const masterId = select.value;
  const base = bases.find(b => b.id === baseId);
  if (!base || !base.serviceStation) return;
  if (base.serviceStation.master) {
    changeMaster(baseId, masterId);
  } else {
    hireMaster(baseId, masterId);
  }
}


async function upgradeServiceStation(baseId) {
  if (actionLock) return;
  actionLock = true;
  try {
    const base = bases.find(b => b.id === baseId);
    if (!base || !base.serviceStation) return;
    if (base.serviceStation.upgrading) return;
    if (base.serviceStation.level >= MAX_STO_LEVEL) {
      showStatus('СТО уже максимального уровня');
      return;
    }
    const cost = 1000 * base.serviceStation.level;
    if (balance < cost) {
      showStatus('❌ Недостаточно средств');
      return;
    }
    base.serviceStation.upgrading = true;
    refreshBasePanel(baseId);
    balance -= cost;
    await saveBalance(-cost, `Улучшение СТО ${base.name}`);
    base.serviceStation.level += 1;
    base.serviceStation.upgrading = false;
    saveBases();
    openBasePanel(baseId);
    showStatus(`🏗 СТО улучшена до уровня ${base.serviceStation.level}`);
  } finally {
    actionLock = false;
  }
}

async function serviceAllVehicles(baseId) {
  const base = bases.find(b => b.id === baseId);
  if (!base || !base.serviceStation || !base.serviceStation.master) return;
  if (base.serviceStation.mechanic && base.serviceStation.mechanic.status !== 'idle') {
    showStatus('Механик на выезде');
    return;
  }
  const vehicles = base.vehicles.filter(v => v.condition < 100);
  if (!vehicles.length) {
    showStatus('Все машины в порядке');
    return;
  }
  const costPer = getServiceCost(base);
  const total = costPer * vehicles.length;
  if (balance < total) {
    showStatus('❌ Недостаточно средств');
    return;
  }
  balance -= total;
  await saveBalance(-total, `ТО всех машин ${base.name}`);
  vehicles.forEach(v => v.condition = 100);
  saveBases();
  openBasePanel(baseId);
  showStatus(`🔧 Обслужено машин: ${vehicles.length}`);
}

async function getAddressFromCoords(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const response = await fetch(url);
    const data = await response.json();
    const addr = data.address;

    const parts = [];

    if (data.name) parts.push(data.name);
    if (addr.house_number) parts.push(`д. ${addr.house_number}`);
    if (addr.road) parts.push(addr.road);
    if (addr.city) parts.push(addr.city);

    return parts.join(', ');
  } catch (err) {
    console.error("Ошибка получения адреса:", err);
    return "Адрес не найден";
  }
}


// Получение данных OSM
async function getNearbyOSMFeatures() {
  const bounds = map.getBounds();
  const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;

  const query = `
    [out:json][timeout:25];
    (
      node["highway"]( ${bbox} );
      node["building"]( ${bbox} );
      node["amenity"="hospital"]( ${bbox} );
      node["amenity"="school"]( ${bbox} );
      node["amenity"="police"]( ${bbox} );
    );
    out center;
  `;

  const url = 'https://overpass-api.de/api/interpreter';

  try {
    const response = await fetch(url, {
      method: "POST",
      body: query
    });

    const json = await response.json();
    return json.elements.filter(e => e.lat && e.lon);
  } catch (err) {
    console.error("Ошибка загрузки OSM:", err);
    return [];
  }
}

async function init() {
  connectSocket();
  await flushPendingSave();
  loadCartFromStorage();
  await loadCallTypes(); // загружаем calls.json
  await loadGameData();
  cleanCart();
  updateCartCount();
  await loadNews();
  // периодически подгружаем новости без перезагрузки страницы
  setInterval(loadNews, 30000);
  updateCallListUI();
  const baseModal = document.getElementById('base-modal');
  if (baseModal) {
    baseModal.addEventListener('click', e => {
      if (e.target === baseModal) closeBasePanel();
    });
  }
  const historyModal = document.getElementById('history-modal');
  if (historyModal) {
    historyModal.addEventListener('click', e => {
      if (e.target === historyModal) closeHistoryModal();
    });
  }
  const vehicleModal = document.getElementById('vehicle-modal');
  if (vehicleModal) {
    vehicleModal.addEventListener('click', e => {
      if (e.target === vehicleModal) closeVehicleModal();
    });
  }
  const callModal = document.getElementById('call-modal');
  if (callModal) {
    callModal.addEventListener('click', e => {
      if (e.target === callModal) closeCallModal();
    });
  }
  const profileModal = document.getElementById('profile-modal');
  if (profileModal) {
    profileModal.addEventListener('click', e => {
      if (e.target === profileModal) closeProfileModal();
    });
  }
  const bugReportModal = document.getElementById('bug-report-modal');
  if (bugReportModal) {
    bugReportModal.addEventListener('click', e => {
      if (e.target === bugReportModal) closeBugReportModal();
    });
  }
  const cartModal = document.getElementById('cart-modal');
  if (cartModal) {
    cartModal.addEventListener('click', e => {
      if (e.target === cartModal) closeCartModal();
    });
  }
  function closeTopModal() {
    const modals = [
      { el: baseModal, close: closeBasePanel },
      { el: historyModal, close: closeHistoryModal },
      { el: vehicleModal, close: closeVehicleModal },
      { el: cartModal, close: closeCartModal },
      { el: callModal, close: closeCallModal },
      { el: profileModal, close: closeProfileModal },
      { el: bugReportModal, close: closeBugReportModal }
    ];
    let top = null;
    let topZ = -Infinity;
    for (const m of modals) {
      if (m.el && m.el.style.display === 'block') {
        const z = parseInt(getComputedStyle(m.el).zIndex) || 0;
        if (z > topZ) {
          topZ = z;
          top = m;
        } else if (z === topZ && top) {
          const pos = top.el.compareDocumentPosition(m.el);
          if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
            top = m;
          }
        }
      }
    }
    if (top) top.close();
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (zoneEdit.baseId) {
        finishZoneEdit(false);
      } else if (addingBaseMode) {
        cancelAddBase();
      } else {
        closeTopModal();
      }
    }
  });
  const newsWindow = document.getElementById('news-window');
  const collapseBtn = document.getElementById('news-collapse-btn');
  const readAllBtn = document.getElementById('news-readall-btn');
  if (newsWindow && collapseBtn) {
    const collapsed = localStorage.getItem('newsCollapsed') === 'true';
    if (collapsed) {
      newsWindow.classList.add('collapsed');
      collapseBtn.innerHTML = '&#x25BC;';
    }
    collapseBtn.addEventListener('click', () => {
      newsWindow.classList.toggle('collapsed');
      const isCol = newsWindow.classList.contains('collapsed');
      collapseBtn.innerHTML = isCol ? '&#x25BC;' : '&#x25B2;';
      localStorage.setItem('newsCollapsed', isCol);
    });
  }
  if (readAllBtn) {
    readAllBtn.addEventListener('click', () => {
      markAllNewsRead();
    });
  }
  setInterval(() => {
  const now = Date.now();
  bases.forEach(b => {
    if (b.serviceStation && b.serviceStation.mechanic && b.serviceStation.mechanic.status === 'return' && !b.serviceStation.mechanic.moveTimer) {
      b.serviceStation.mechanic.status = 'idle';
    }
  });
  document.querySelectorAll('.elapsed').forEach(el => {
    const ts = parseInt(el.dataset.timestamp);
    if (!isNaN(ts)) {
      el.textContent = formatElapsedTime(now - ts);
    }
  });
  document.querySelectorAll('.countdown').forEach(el => {
    const ts = parseInt(el.dataset.timestamp);
    const remaining = callTimeout - (now - ts);
    el.textContent = remaining > 0 ? formatElapsedTime(remaining) : formatElapsedTime(callTimeout);
  });
  document.querySelectorAll('.eta').forEach(el => {
    const callId = el.dataset.call;
    const call = callMarkers.find(c => c.id === callId);
    if (!call) return;
    const allReq = hasAllRequiredOnScene(call);
    if (allReq) {
      const remaining = getRemainingTime(call);
      el.textContent = formatElapsedTime(remaining);
    } else {
      el.textContent = 'Ожидание машин...';
    }
  });
  document.querySelectorAll('.arrival').forEach(el => {
    const vid = el.dataset.vehicle;
    let vehicle;
    for (const b of bases) {
      vehicle = b.vehicles.find(v => v.id === vid);
      if (vehicle) break;
    }
    if (vehicle) {
      if (vehicle.status === 'enroute' && vehicle.route && vehicle.route.length > 1) {
        const remaining = computeRouteDistance(vehicle.route) * (1 - (vehicle.routeProgress || 0) / 100);
        const ms = estimateTravelTime(remaining, vehicle.speed);
        el.textContent = formatElapsedTime(ms);
      } else {
        el.textContent = '';
      }
    }
  });
  checkUnresolvedCalls(now);
  updateCallProgress();
}, 1000);
}

// При запуске — загружаем сохранённые базы
document.addEventListener('DOMContentLoaded', () => {
  init(); // вызываем асинхронную функцию запуска
});

function handlePageHide() {
  if (!skipUnloadSave) {
    saveGameDataSync();
  }
  skipUnloadSave = false;
}

window.addEventListener('beforeunload', handlePageHide);
// Safari иногда игнорирует beforeunload при обновлении страницы
window.addEventListener('pagehide', handlePageHide);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    handlePageHide();
  }
});

// Close bug report modal when iframe signals success
window.addEventListener('message', function (e) {
  if (e && e.data && e.data.type === 'bug-report-submitted') {
    closeBugReportModal();
  }
});

