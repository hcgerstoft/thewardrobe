import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "./lib/supabase.js";
import {
  Plus, Shirt, Sparkles, WashingMachine, BarChart3,
  Lock, LockOpen, Trash2, Pencil, RefreshCw, Camera, X, Check, Tag, LogOut, Mail
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIES = ["Top", "Bottom", "Dress", "Outerwear", "Shoes", "Accessory"];
const CURRENCIES = ["kr", "€", "$", "£"];
const BUCKET = "photos";
const SIGNED_URL_TTL = 60 * 60; // 1 hour

/* ------------------------------------------------------------------ */
/*  DB row <-> app item mapping                                        */
/* ------------------------------------------------------------------ */

const dbToItem = (r) => ({
  id: r.id,
  name: r.name,
  brand: r.brand,
  category: r.category,
  value: Number(r.value) || 0,
  tags: r.tags || [],
  status: r.status,
  wearCount: r.wear_count || 0,
  hasPhoto: r.has_photo,
});

const itemToDb = (i, userId) => ({
  id: i.id,
  user_id: userId,
  name: i.name,
  brand: i.brand,
  category: i.category,
  value: i.value,
  tags: i.tags,
  status: i.status,
  wear_count: i.wearCount,
  has_photo: i.hasPhoto,
});

const photoPath = (userId, itemId) => `${userId}/${itemId}.jpg`;

/* ------------------------------------------------------------------ */
/*  Image compression -> JPEG blob                                     */
/* ------------------------------------------------------------------ */

const compressImage = (file) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 900;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("compress failed"))),
        "image/jpeg",
        0.8
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });

/* ------------------------------------------------------------------ */
/*  Outfit generation — tag-threaded                                   */
/* ------------------------------------------------------------------ */

function generateOutfit(items, lockedIds) {
  const fresh = items.filter((i) => i.status === "fresh");
  if (!fresh.length) return null;

  const locked = fresh.filter((i) => lockedIds.includes(i.id));
  const outfit = [...locked];
  const tagPool = new Set(outfit.flatMap((i) => i.tags));

  const inOutfit = (id) => outfit.some((o) => o.id === id);
  const candidates = (cat) => fresh.filter((i) => i.category === cat && !inOutfit(i.id));
  const overlap = (item) => item.tags.filter((t) => tagPool.has(t)).length;

  const pickFor = (cat, required) => {
    if (outfit.some((i) => i.category === cat)) return;
    let cands = candidates(cat);
    if (!cands.length) return;
    if (tagPool.size) {
      const matching = cands.filter((c) => overlap(c) > 0);
      if (matching.length) {
        const max = Math.max(...matching.map(overlap));
        cands = matching.filter((c) => overlap(c) >= Math.max(1, max - 1));
      } else if (!required) {
        return;
      }
    }
    const chosen = cands[Math.floor(Math.random() * cands.length)];
    outfit.push(chosen);
    chosen.tags.forEach((t) => tagPool.add(t));
  };

  const dressLocked = outfit.some((i) => i.category === "Dress");
  const topBotLocked = outfit.some((i) => i.category === "Top" || i.category === "Bottom");
  let useDress;
  if (dressLocked) useDress = true;
  else if (topBotLocked) useDress = false;
  else {
    const dresses = candidates("Dress");
    const tops = candidates("Top");
    useDress = dresses.length > 0 && (tops.length === 0 || Math.random() < 0.3);
  }

  if (!tagPool.size) {
    const core = useDress
      ? candidates("Dress")
      : [...candidates("Top"), ...candidates("Bottom")];
    const pool = core.length ? core : fresh;
    const seed = pool[Math.floor(Math.random() * pool.length)];
    outfit.push(seed);
    seed.tags.forEach((t) => tagPool.add(t));
  }

  if (useDress) pickFor("Dress", true);
  else { pickFor("Top", true); pickFor("Bottom", true); }
  pickFor("Shoes", true);
  pickFor("Outerwear", false);
  pickFor("Accessory", false);

  return outfit.length ? outfit : null;
}

/* ------------------------------------------------------------------ */
/*  Small pieces                                                       */
/* ------------------------------------------------------------------ */

const Stamp = ({ status }) => (
  <span className={`wd-stamp ${status === "fresh" ? "wd-stamp-fresh" : "wd-stamp-worn"}`}>
    {status === "fresh" ? "FRESH" : "WORN"}
  </span>
);

const TagChip = ({ text, highlight }) => (
  <span className={`wd-tag ${highlight ? "wd-tag-hl" : ""}`}>{text}</span>
);

const Swatch = ({ item, photo }) =>
  photo ? (
    <img src={photo} alt={item.name} className="wd-swatch-img" />
  ) : (
    <div className="wd-swatch-empty">
      <Shirt size={26} strokeWidth={1.2} />
      <span>{item.category}</span>
    </div>
  );

/* ------------------------------------------------------------------ */
/*  Sign-in screen (magic link)                                        */
/* ------------------------------------------------------------------ */

function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div className="wd-auth">
      <div className="wd-eyebrow">CARE LABEL · PERSONAL EDITION</div>
      <h1>The Wardrobe</h1>
      {sent ? (
        <p className="wd-lede">
          Check your inbox — a sign-in link is on its way to <b>{email}</b>.
          Open it on this device and your closet unlocks.
        </p>
      ) : (
        <>
          <p className="wd-lede">
            Sign in with your email. No password — a one-time link lands in your inbox.
          </p>
          <div className="wd-auth-row">
            <input
              type="email"
              value={email}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email.includes("@") && send()}
            />
            <button className="wd-primary" onClick={send} disabled={busy || !email.includes("@")}>
              <Mail size={16} /> {busy ? "Sending…" : "Send link"}
            </button>
          </div>
          {error && <p className="wd-error">{error}</p>}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Item form (add / edit)                                             */
/* ------------------------------------------------------------------ */

function ItemForm({ initial, onSave, onClose, currency }) {
  const [name, setName] = useState(initial?.name || "");
  const [brand, setBrand] = useState(initial?.brand || "");
  const [category, setCategory] = useState(initial?.category || "Top");
  const [value, setValue] = useState(initial?.value ?? "");
  const [tagInput, setTagInput] = useState((initial?.tags || []).join(", "));
  const [photoBlob, setPhotoBlob] = useState(null);       // newly chosen photo
  const [preview, setPreview] = useState(initial?.photoUrl || null);
  const [removedPhoto, setRemovedPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressImage(file);
      setPhotoBlob(blob);
      setPreview(URL.createObjectURL(blob));
      setRemovedPhoto(false);
    } catch { /* ignore */ }
    setBusy(false);
  };

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const tags = tagInput
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const keepExistingPhoto = initial?.hasPhoto && !photoBlob && !removedPhoto;
    await onSave(
      {
        id: initial?.id || crypto.randomUUID(),
        name: name.trim(),
        brand: brand.trim(),
        category,
        value: Math.max(0, parseFloat(value) || 0),
        tags: [...new Set(tags)],
        status: initial?.status || "fresh",
        wearCount: initial?.wearCount || 0,
        hasPhoto: !!photoBlob || keepExistingPhoto,
      },
      photoBlob,
      removedPhoto
    );
    setSaving(false);
  };

  return (
    <div className="wd-overlay" onClick={onClose}>
      <div className="wd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wd-modal-head">
          <h2>{initial ? "Edit item" : "New item"}</h2>
          <button className="wd-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="wd-photo-drop" onClick={() => fileRef.current?.click()}>
          {preview ? (
            <img src={preview} alt="preview" />
          ) : (
            <div className="wd-photo-hint">
              <Camera size={22} strokeWidth={1.4} />
              <span>{busy ? "Processing…" : "Add a photo"}</span>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
        </div>
        {preview && (
          <button
            className="wd-text-btn"
            onClick={() => { setPreview(null); setPhotoBlob(null); setRemovedPhoto(true); }}
          >
            Remove photo
          </button>
        )}

        <label className="wd-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wool overshirt" />
        </label>
        <div className="wd-row">
          <label className="wd-field">
            <span>Brand</span>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Norse Projects" />
          </label>
          <label className="wd-field">
            <span>Value ({currency})</span>
            <input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} placeholder="800" />
          </label>
        </div>
        <label className="wd-field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="wd-field">
          <span>Tags — comma separated, these thread outfits together</span>
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="casual, autumn, navy" />
        </label>

        <button className="wd-primary" onClick={submit} disabled={!name.trim() || saving}>
          <Check size={16} /> {saving ? "Saving…" : initial ? "Save changes" : "Add to closet"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main app                                                           */
/* ------------------------------------------------------------------ */

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking
  const [items, setItems] = useState([]);
  const [photos, setPhotos] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("closet");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [outfit, setOutfit] = useState(null);
  const [lockedIds, setLockedIds] = useState([]);
  const [currency, setCurrency] = useState(() => {
    try { return window.localStorage.getItem("wd-currency") || "kr"; } catch { return "kr"; }
  });
  const [filterCat, setFilterCat] = useState("All");
  const [toast, setToast] = useState(null);

  const userId = session?.user?.id;

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  /* ---- auth ---- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  /* ---- load closet ---- */
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("items")
        .select("*")
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) { flash(`Couldn't load closet: ${error.message}`); setLoaded(true); return; }
      const list = (data || []).map(dbToItem);
      setItems(list);
      setLoaded(true);
      // Signed photo URLs, fetched in one batch
      const withPhotos = list.filter((i) => i.hasPhoto);
      if (withPhotos.length) {
        const paths = withPhotos.map((i) => photoPath(userId, i.id));
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrls(paths, SIGNED_URL_TTL);
        if (cancelled || !signed) return;
        const map = {};
        signed.forEach((s, idx) => { if (s.signedUrl) map[withPhotos[idx].id] = s.signedUrl; });
        setPhotos(map);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  /* ---- item ops (optimistic local state + write-through) ---- */

  const saveItem = async (item, photoBlob, removedPhoto) => {
    if (photoBlob) {
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(photoPath(userId, item.id), photoBlob, {
          upsert: true,
          contentType: "image/jpeg",
        });
      if (upErr) { flash(`Photo upload failed: ${upErr.message}`); item.hasPhoto = false; }
      else {
        const { data: s } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(photoPath(userId, item.id), SIGNED_URL_TTL);
        if (s?.signedUrl) setPhotos((p) => ({ ...p, [item.id]: s.signedUrl }));
      }
    } else if (removedPhoto) {
      await supabase.storage.from(BUCKET).remove([photoPath(userId, item.id)]);
      setPhotos((p) => { const n = { ...p }; delete n[item.id]; return n; });
    }

    const { error } = await supabase.from("items").upsert(itemToDb(item, userId));
    if (error) { flash(`Save failed: ${error.message}`); return; }

    setItems((prev) => {
      const exists = prev.some((i) => i.id === item.id);
      return exists ? prev.map((i) => (i.id === item.id ? item : i)) : [...prev, item];
    });
    setShowForm(false);
    setEditing(null);
  };

  const deleteItem = async (id) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setLockedIds((l) => l.filter((x) => x !== id));
    if (outfit) setOutfit((o) => o && o.filter((x) => x.id !== id));
    await supabase.storage.from(BUCKET).remove([photoPath(userId, id)]);
    const { error } = await supabase.from("items").delete().eq("id", id);
    if (error) flash(`Delete failed: ${error.message}`);
  };

  const setStatus = async (ids, status, countWear) => {
    const updated = items.map((i) =>
      ids.includes(i.id)
        ? { ...i, status, wearCount: countWear ? (i.wearCount || 0) + 1 : i.wearCount }
        : i
    );
    setItems(updated);
    const results = await Promise.all(
      updated
        .filter((i) => ids.includes(i.id))
        .map((i) =>
          supabase
            .from("items")
            .update({ status: i.status, wear_count: i.wearCount })
            .eq("id", i.id)
        )
    );
    const failed = results.find((r) => r.error);
    if (failed) flash(`Sync failed: ${failed.error.message}`);
  };

  /* ---- outfit ---- */
  const shuffle = () => setOutfit(generateOutfit(items, lockedIds));
  const toggleLock = (id) =>
    setLockedIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  const wearOutfit = async () => {
    if (!outfit) return;
    await setStatus(outfit.map((o) => o.id), "worn", true);
    setOutfit(null);
    setLockedIds([]);
    flash("Outfit logged — pieces moved to the laundry basket");
  };

  /* ---- derived ---- */
  const freshItems = items.filter((i) => i.status === "fresh");
  const wornItems = items.filter((i) => i.status === "worn");
  const totalValue = items.reduce((s, i) => s + (i.value || 0), 0);

  const sharedTags = useMemo(() => {
    if (!outfit) return [];
    const counts = {};
    outfit.forEach((i) => i.tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.keys(counts).filter((t) => counts[t] >= 2);
  }, [outfit]);

  const fmt = (n) => `${currency} ${Number(n).toLocaleString()}`;
  const visibleItems = filterCat === "All" ? items : items.filter((i) => i.category === filterCat);

  const cpw = (i) => (i.wearCount > 0 ? i.value / i.wearCount : null);
  const bestValue = [...items].filter((i) => i.wearCount > 0 && i.value > 0).sort((a, b) => cpw(a) - cpw(b))[0];
  const neglected = items.filter((i) => !i.wearCount);
  const catValues = CATEGORIES.map((c) => ({
    cat: c,
    v: items.filter((i) => i.category === c).reduce((s, i) => s + (i.value || 0), 0),
  })).filter((x) => x.v > 0);
  const maxCatV = Math.max(1, ...catValues.map((x) => x.v));

  /* ---- render ---- */

  if (session === undefined) {
    return <div className="wd-root"><div className="wd-loading">Opening the closet…</div></div>;
  }
  if (!session) {
    return <div className="wd-root"><SignIn /></div>;
  }
  if (!loaded) {
    return <div className="wd-root"><div className="wd-loading">Opening the closet…</div></div>;
  }

  return (
    <div className="wd-root">
      <header className="wd-header">
        <div>
          <div className="wd-eyebrow">CARE LABEL · PERSONAL EDITION</div>
          <h1>The Wardrobe</h1>
        </div>
        <div className="wd-header-stats">
          <div><b>{items.length}</b><span>pieces</span></div>
          <div><b>{freshItems.length}</b><span>fresh</span></div>
          <div><b>{fmt(totalValue)}</b><span>est. value</span></div>
          <select
            className="wd-currency"
            value={currency}
            aria-label="Currency"
            onChange={(e) => {
              setCurrency(e.target.value);
              try { window.localStorage.setItem("wd-currency", e.target.value); } catch { /* ignore */ }
            }}
          >
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="wd-icon-btn" aria-label="Sign out" title="Sign out"
            onClick={() => supabase.auth.signOut()}>
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <nav className="wd-tabs">
        {[
          ["closet", "Closet", Shirt],
          ["outfit", "Outfit", Sparkles],
          ["laundry", "Laundry", WashingMachine],
          ["insights", "Insights", BarChart3],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            className={`wd-tab ${tab === key ? "wd-tab-active" : ""}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} strokeWidth={1.8} />
            {label}
            {key === "laundry" && wornItems.length > 0 && (
              <span className="wd-badge">{wornItems.length}</span>
            )}
          </button>
        ))}
      </nav>

      {/* ---------------- CLOSET ---------------- */}
      {tab === "closet" && (
        <section>
          <div className="wd-toolbar">
            <div className="wd-filters">
              {["All", ...CATEGORIES].map((c) => (
                <button
                  key={c}
                  className={`wd-filter ${filterCat === c ? "wd-filter-on" : ""}`}
                  onClick={() => setFilterCat(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <button className="wd-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
              <Plus size={16} /> Add item
            </button>
          </div>

          {visibleItems.length === 0 ? (
            <div className="wd-empty">
              <Shirt size={34} strokeWidth={1} />
              <p>{items.length === 0
                ? "An empty closet is a blank page. Add your first piece."
                : "Nothing in this category yet."}</p>
            </div>
          ) : (
            <div className="wd-grid">
              {visibleItems.map((item) => (
                <article key={item.id} className={`wd-card ${item.status === "worn" ? "wd-card-worn" : ""}`}>
                  <div className="wd-swatch">
                    <Swatch item={item} photo={photos[item.id]} />
                    <Stamp status={item.status} />
                  </div>
                  <div className="wd-card-body">
                    <div className="wd-brand">{item.brand || "—"}</div>
                    <div className="wd-name">{item.name}</div>
                    <div className="wd-meta">
                      <span>{item.category}</span>
                      <span>{fmt(item.value)}</span>
                      <span>{item.wearCount || 0}× worn</span>
                    </div>
                    <div className="wd-tags">
                      {item.tags.length
                        ? item.tags.map((t) => <TagChip key={t} text={t} />)
                        : <span className="wd-no-tags"><Tag size={11} /> no tags</span>}
                    </div>
                  </div>
                  <div className="wd-card-actions">
                    {item.status === "fresh" ? (
                      <button className="wd-mini" onClick={() => setStatus([item.id], "worn", true)}>
                        Mark worn
                      </button>
                    ) : (
                      <button className="wd-mini" onClick={() => setStatus([item.id], "fresh", false)}>
                        Mark washed
                      </button>
                    )}
                    <span className="wd-spacer" />
                    <button className="wd-icon-btn" aria-label="Edit"
                      onClick={() => { setEditing({ ...item, photoUrl: photos[item.id] || null }); setShowForm(true); }}>
                      <Pencil size={14} />
                    </button>
                    <button className="wd-icon-btn wd-danger" aria-label="Delete" onClick={() => deleteItem(item.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ---------------- OUTFIT ---------------- */}
      {tab === "outfit" && (
        <section>
          <div className="wd-outfit-head">
            <p className="wd-lede">
              Pieces pair up when their tags overlap. Only fresh, laundered items make the cut.
              Lock anything you want to keep, then reshuffle around it.
            </p>
            <div className="wd-outfit-btns">
              <button className="wd-primary" onClick={shuffle} disabled={!freshItems.length}>
                <RefreshCw size={16} /> {outfit ? "Reshuffle" : "Generate outfit"}
              </button>
              {outfit && (
                <button className="wd-secondary" onClick={wearOutfit}>
                  <Check size={16} /> Wear this — mark all worn
                </button>
              )}
            </div>
          </div>

          {!freshItems.length && (
            <div className="wd-empty">
              <WashingMachine size={34} strokeWidth={1} />
              <p>Everything is in the laundry basket. Run a load first.</p>
            </div>
          )}

          {outfit && (
            <>
              {sharedTags.length > 0 && (
                <div className="wd-thread">
                  <span>The thread:</span>
                  {sharedTags.map((t) => <TagChip key={t} text={t} highlight />)}
                </div>
              )}
              <div className="wd-grid">
                {outfit.map((item) => (
                  <article key={item.id} className="wd-card">
                    <div className="wd-swatch">
                      <Swatch item={item} photo={photos[item.id]} />
                      <span className="wd-slot">{item.category}</span>
                    </div>
                    <div className="wd-card-body">
                      <div className="wd-brand">{item.brand || "—"}</div>
                      <div className="wd-name">{item.name}</div>
                      <div className="wd-tags">
                        {item.tags.map((t) => (
                          <TagChip key={t} text={t} highlight={sharedTags.includes(t)} />
                        ))}
                      </div>
                    </div>
                    <div className="wd-card-actions">
                      <button
                        className={`wd-mini ${lockedIds.includes(item.id) ? "wd-mini-on" : ""}`}
                        onClick={() => toggleLock(item.id)}
                      >
                        {lockedIds.includes(item.id) ? <Lock size={13} /> : <LockOpen size={13} />}
                        {lockedIds.includes(item.id) ? "Locked" : "Lock"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ---------------- LAUNDRY ---------------- */}
      {tab === "laundry" && (
        <section>
          <div className="wd-toolbar">
            <p className="wd-lede">
              Worn pieces sit here until washed. They're skipped by the outfit generator.
            </p>
            {wornItems.length > 0 && (
              <button className="wd-primary" onClick={() => setStatus(wornItems.map((i) => i.id), "fresh", false)}>
                <WashingMachine size={16} /> Run a load — wash all
              </button>
            )}
          </div>
          {wornItems.length === 0 ? (
            <div className="wd-empty">
              <Check size={34} strokeWidth={1} />
              <p>The basket is empty. Everything is fresh and ready to wear.</p>
            </div>
          ) : (
            <div className="wd-grid">
              {wornItems.map((item) => (
                <article key={item.id} className="wd-card wd-card-worn">
                  <div className="wd-swatch">
                    <Swatch item={item} photo={photos[item.id]} />
                    <Stamp status="worn" />
                  </div>
                  <div className="wd-card-body">
                    <div className="wd-brand">{item.brand || "—"}</div>
                    <div className="wd-name">{item.name}</div>
                  </div>
                  <div className="wd-card-actions">
                    <button className="wd-mini" onClick={() => setStatus([item.id], "fresh", false)}>
                      Wash this one
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ---------------- INSIGHTS ---------------- */}
      {tab === "insights" && (
        <section className="wd-insights">
          <div className="wd-stat-cards">
            <div className="wd-stat">
              <span className="wd-stat-label">Closet value</span>
              <span className="wd-stat-num">{fmt(totalValue)}</span>
            </div>
            <div className="wd-stat">
              <span className="wd-stat-label">Best cost per wear</span>
              {bestValue ? (
                <>
                  <span className="wd-stat-num">{fmt(cpw(bestValue).toFixed(0))}</span>
                  <span className="wd-stat-sub">{bestValue.name} · {bestValue.wearCount}× worn</span>
                </>
              ) : <span className="wd-stat-sub">Wear something first</span>}
            </div>
            <div className="wd-stat">
              <span className="wd-stat-label">In the basket</span>
              <span className="wd-stat-num">{wornItems.length}</span>
              <span className="wd-stat-sub">of {items.length} pieces</span>
            </div>
          </div>

          {catValues.length > 0 && (
            <div className="wd-panel">
              <h3>Value by category</h3>
              {catValues.map(({ cat, v }) => (
                <div key={cat} className="wd-bar-row">
                  <span className="wd-bar-label">{cat}</span>
                  <div className="wd-bar-track">
                    <div className="wd-bar" style={{ width: `${(v / maxCatV) * 100}%` }} />
                  </div>
                  <span className="wd-bar-val">{fmt(v)}</span>
                </div>
              ))}
            </div>
          )}

          {neglected.length > 0 && (
            <div className="wd-panel">
              <h3>Gathering dust — never worn</h3>
              <p className="wd-panel-sub">
                {fmt(neglected.reduce((s, i) => s + (i.value || 0), 0))} of value waiting on a hanger.
                Lock one of these in the generator and build around it.
              </p>
              <div className="wd-dust-list">
                {neglected.map((i) => (
                  <span key={i.id} className="wd-dust">{i.name}</span>
                ))}
              </div>
            </div>
          )}

          {items.length === 0 && (
            <div className="wd-empty">
              <BarChart3 size={34} strokeWidth={1} />
              <p>Insights appear once your closet has pieces in it.</p>
            </div>
          )}
        </section>
      )}

      {showForm && (
        <ItemForm
          initial={editing}
          currency={currency}
          onSave={saveItem}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {toast && <div className="wd-toast">{toast}</div>}
    </div>
  );
}
