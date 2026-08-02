const state = {
  photos: [],
  allPhotos: [],
  selected: new Set(),
  lightboxIndex: -1,
  observer: null,
  page: document.body.dataset.page || "gallery",
};

const $ = (id) => document.getElementById(id);
const RETOUCH_STORAGE_KEY = "gpho-gallery-01-retouch-queue";

const els = {
  grid: $("grid"),
  loading: $("loading"),
  meta: $("meta"),
  selectAll: $("selectAll"),
  selectionBar: $("selectionBar"),
  selectedCount: $("selectedCount"),
  selectedLabel: $("selectedLabel"),
  selectedSize: $("selectedSize"),
  selectedHint: $("selectedHint"),
  clearSelection: $("clearSelection"),
  downloadSelection: $("downloadSelection"),
  addToRetouch: $("addToRetouch"),
  removeFromRetouch: $("removeFromRetouch"),
  openRetouch: $("openRetouch"),
  lightbox: $("lightbox"),
  lightboxName: $("lightboxName"),
  lightboxImage: $("lightboxImage"),
  closeLightbox: $("closeLightbox"),
  prevPhoto: $("prevPhoto"),
  nextPhoto: $("nextPhoto"),
  toggleLightboxSelection: $("toggleLightboxSelection"),
  downloadSingle: $("downloadSingle"),
};

init();

async function init() {
  try {
    const response = await fetch("photos.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load photos.json (${response.status})`);
    const data = await response.json();
    state.allPhotos = data.photos || [];
    state.photos = state.page === "retouch"
      ? getRetouchPhotos(state.allPhotos)
      : state.allPhotos;
    setupObserver();
    renderGrid();
    bindEvents();
    syncRetouchLink();
    els.loading.style.display = "none";
    syncPageMeta();
  } catch (error) {
    els.loading.textContent = error.message;
  }
}

function syncRetouchLink() {
  const filenames = readStoredRetouchQueue();
  if (els.openRetouch && filenames.length) {
    els.openRetouch.href = buildRetouchHref(filenames);
  }
}

function setupObserver() {
  state.observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target;
      image.src = image.dataset.src;
      image.removeAttribute("data-src");
      state.observer.unobserve(image);
    }
  }, { rootMargin: "360px" });
}

function renderGrid() {
  const fragment = document.createDocumentFragment();
  state.photos.forEach((photo, index) => {
    const cell = document.createElement("button");
    cell.className = "cell";
    cell.type = "button";
    cell.dataset.index = String(index);
    cell.setAttribute("aria-label", `Open ${photo.filename}`);
    cell.innerHTML = `
      <img data-src="${escapeAttribute(photo.thumb)}" alt="" loading="lazy" width="${photo.width}" height="${photo.height}">
      <span class="check" aria-hidden="true">✓</span>
      <span class="filename">${escapeHtml(photo.filename)}</span>
    `;
    fragment.appendChild(cell);
    state.observer.observe(cell.querySelector("img"));
  });
  els.grid.appendChild(fragment);
}

function bindEvents() {
  els.grid.addEventListener("click", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell) return;
    const index = Number(cell.dataset.index);
    if (event.target.closest(".check") || event.shiftKey || event.ctrlKey || event.metaKey) {
      toggleSelection(state.photos[index].filename);
      return;
    }
    openLightbox(index);
  });

  els.selectAll.addEventListener("click", toggleAll);
  els.clearSelection.addEventListener("click", clearSelection);
  els.downloadSelection.addEventListener("click", downloadSelectedOriginals);
  els.addToRetouch?.addEventListener("click", addSelectionToRetouch);
  els.removeFromRetouch?.addEventListener("click", removeSelectionFromRetouch);
  els.closeLightbox.addEventListener("click", closeLightbox);
  els.prevPhoto.addEventListener("click", () => moveLightbox(-1));
  els.nextPhoto.addEventListener("click", () => moveLightbox(1));
  els.toggleLightboxSelection.addEventListener("click", toggleLightboxSelection);

  document.addEventListener("keydown", (event) => {
    if (state.lightboxIndex < 0) return;
    if (event.key === "Escape") closeLightbox();
    if (event.key === "ArrowLeft") moveLightbox(-1);
    if (event.key === "ArrowRight") moveLightbox(1);
    if (event.key === " ") {
      event.preventDefault();
      toggleLightboxSelection();
    }
  });
}

function toggleAll() {
  if (state.selected.size === state.photos.length) {
    state.selected.clear();
  } else {
    for (const photo of state.photos) state.selected.add(photo.filename);
  }
  syncUi();
}

function clearSelection() {
  state.selected.clear();
  syncUi();
}

function toggleSelection(filename) {
  if (state.selected.has(filename)) {
    state.selected.delete(filename);
  } else {
    state.selected.add(filename);
  }
  syncUi();
}

function syncUi() {
  const count = state.selected.size;
  document.body.classList.toggle("has-selection", count > 0);
  els.selectionBar.classList.toggle("show", count > 0);
  els.selectedCount.textContent = String(count);
  els.selectedLabel.textContent = count === 1 ? "photo selected" : "photos selected";
  els.selectedSize.textContent = count ? ` | ${formatBytes(selectedBytes())}` : "";
  els.selectedHint.textContent = count > 1
    ? "Browser will request each original file"
    : "Original files only";
  els.selectAll.textContent = count > 0 && count === state.photos.length ? "Clear All" : "Select All";
  els.selectAll.classList.toggle("active", count > 0);
  if (els.addToRetouch) {
    els.addToRetouch.disabled = count === 0;
    els.addToRetouch.textContent = count > 0 ? "Add to Retouch" : "Add to Retouch";
  }
  if (els.removeFromRetouch) {
    els.removeFromRetouch.disabled = count === 0;
  }

  document.querySelectorAll(".cell").forEach((cell, index) => {
    cell.classList.toggle("selected", state.selected.has(state.photos[index].filename));
  });

  if (state.lightboxIndex >= 0) syncLightboxButtons();
}

function syncPageMeta() {
  if (state.page === "retouch") {
    els.meta.textContent = state.photos.length
      ? `${state.photos.length} retouch photos | originals only`
      : "No retouch photos in this link";
    if (!state.photos.length) {
      els.loading.style.display = "grid";
      els.loading.innerHTML = 'No retouch photos selected. <a href="index.html">Return to gallery</a>.';
    }
    return;
  }

  els.meta.textContent = `${state.photos.length} photos | originals in repository`;
}

function openLightbox(index) {
  state.lightboxIndex = index;
  const photo = state.photos[index];
  els.lightboxName.textContent = `${photo.filename} | ${formatBytes(photo.size)}`;
  els.lightboxImage.src = photo.preview;
  els.lightboxImage.alt = photo.filename;
  els.downloadSingle.href = photo.original;
  els.downloadSingle.download = photo.filename;
  els.lightbox.classList.add("open");
  document.body.style.overflow = "hidden";
  syncLightboxButtons();
  els.closeLightbox.focus();
}

function closeLightbox() {
  els.lightbox.classList.remove("open");
  els.lightboxImage.src = "";
  document.body.style.overflow = "";
  state.lightboxIndex = -1;
}

function moveLightbox(direction) {
  const next = state.lightboxIndex + direction;
  if (next < 0 || next >= state.photos.length) return;
  openLightbox(next);
}

function toggleLightboxSelection() {
  const photo = state.photos[state.lightboxIndex];
  if (!photo) return;
  toggleSelection(photo.filename);
}

function syncLightboxButtons() {
  const photo = state.photos[state.lightboxIndex];
  const selected = photo && state.selected.has(photo.filename);
  els.toggleLightboxSelection.textContent = selected ? "Selected" : "Select";
  els.toggleLightboxSelection.classList.toggle("active", Boolean(selected));
}

function downloadSelectedOriginals() {
  const selectedPhotos = state.photos.filter((photo) => state.selected.has(photo.filename));
  if (!selectedPhotos.length) return;
  els.downloadSelection.disabled = true;
  els.downloadSelection.textContent = "Starting...";
  selectedPhotos.forEach((photo, index) => {
    window.setTimeout(() => {
      triggerDownload(photo.original, photo.filename);
      if (index === selectedPhotos.length - 1) {
        window.setTimeout(() => {
          els.downloadSelection.disabled = false;
          els.downloadSelection.textContent = "Download Originals";
        }, 600);
      }
    }, index * 450);
  });
}

function addSelectionToRetouch() {
  const filenames = state.photos
    .filter((photo) => state.selected.has(photo.filename))
    .map((photo) => photo.filename);
  if (!filenames.length) return;

  const current = readStoredRetouchQueue();
  const merged = [...new Set([...current, ...filenames])];
  writeStoredRetouchQueue(merged);

  const href = buildRetouchHref(merged);
  if (els.openRetouch) els.openRetouch.href = href;
  window.location.href = href;
}

function removeSelectionFromRetouch() {
  const selectedFilenames = new Set(state.selected);
  if (!selectedFilenames.size) return;

  const remaining = state.photos
    .filter((photo) => !selectedFilenames.has(photo.filename))
    .map((photo) => photo.filename);
  writeStoredRetouchQueue(remaining);

  window.location.href = remaining.length ? buildRetouchHref(remaining) : "retouch.html";
}

function getRetouchPhotos(allPhotos) {
  const requested = readRetouchQuery();
  const filenames = requested.length ? requested : readStoredRetouchQueue();
  const requestedSet = new Set(filenames);
  return allPhotos.filter((photo) => requestedSet.has(photo.filename));
}

function readRetouchQuery() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("photos");
  if (!value) return [];
  return value
    .split(",")
    .map((filename) => filename.trim())
    .filter(Boolean);
}

function readStoredRetouchQueue() {
  try {
    const value = window.localStorage.getItem(RETOUCH_STORAGE_KEY);
    const filenames = JSON.parse(value || "[]");
    return Array.isArray(filenames) ? filenames.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeStoredRetouchQueue(filenames) {
  try {
    window.localStorage.setItem(RETOUCH_STORAGE_KEY, JSON.stringify(filenames));
  } catch {
    // The URL remains shareable even when local storage is unavailable.
  }
}

function buildRetouchHref(filenames) {
  const params = new URLSearchParams();
  params.set("photos", filenames.join(","));
  return `retouch.html?${params.toString()}`;
}

function triggerDownload(href, filename) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function selectedBytes() {
  let total = 0;
  for (const photo of state.photos) {
    if (state.selected.has(photo.filename)) total += photo.size;
  }
  return total;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
