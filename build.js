// Arma catalogo.json del Catálogo Meraki a partir de la base de la app de gestión.
// Uso: node build.js <carpeta del volcado (la que contiene meraki/data/...)> <carpeta de salida>
// Nunca escribe costos, proveedores, ventas ni clientas: solo lo que está disponible, con precio y foto.
const fs = require("fs"), path = require("path");
const [, , dumpDir, outDir] = process.argv;
if (!dumpDir || !outDir) { console.error("Uso: node build.js <volcado> <salida>"); process.exit(1); }
const base = path.join(dumpDir, "meraki", "data");
const readCol = c => { const d = path.join(base, c), o = {}; if (!fs.existsSync(d)) return o;
  for (const f of fs.readdirSync(d)) if (f.endsWith(".json")) { const j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); o[f.slice(0, -5)] = j.data && typeof j.data === "object" && !Array.isArray(j.data) && Object.keys(j).length <= 4 && j.version != null ? j.data : j; }
  return o; };

const num = x => { const n = typeof x === "number" ? x : parseFloat(String(x ?? "").replace(/\./g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const slug = s => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "producto";
const fotoKey = (p, c) => slug(`${p} ${c || ""}`);
const vkey = s => norm(`${s.modelo}|${s.producto}|${s.color || ""}`);
const estadoKey = e => e === "a entregar" ? "aentregar" : (e || "aentregar");
const descuenta = v => ["aentregar", "entregada"].includes(estadoKey(v.estado));

const stock = readCol("stock"), prd = readCol("productos"), ven = readCol("ventas"), fot = readCol("fotos");
const cfg = (readCol("config").general) || {};
const DEF_ESCALAS = [{precio:10000, packs:[{cant:2, precio:15000},{cant:3, precio:20000}]}, {precio:8000, packs:[{cant:2, precio:12000},{cant:3, precio:15000}]}];
const DEF_COMBOS = [{cats:["Funda","Vidrio templado"], precio:12000}, {cats:["Funda","Vidrio templado","Protector de cámara"], precio:15000}];
const escalas = cfg.escalas || DEF_ESCALAS, combos = cfg.combos || DEF_COMBOS;

// disponible = lo que ingresó − lo vendido (a entregar o entregado), igual que en la app
const sold = {};
Object.values(ven).forEach(v => { if (!descuenta(v)) return; (v.items || []).forEach(it => { if (it.stockId) sold[it.stockId] = (sold[it.stockId] || 0) + num(it.cant); }); });
const vars = {};
Object.entries(stock).forEach(([id, s]) => { const k = vkey(s);
  const v = vars[k] = vars[k] || {modelo: s.modelo || "", producto: s.producto || "", color: s.color || "", categoria: s.categoria || "Funda", disp: 0, docs: []};
  v.disp += num(s.cant) - (sold[id] || 0); v.docs.push({id, ingreso: s.ingreso || "", precio: num(s.precio)}); });

const fotoDe = (p, c) => { const f = fot[fotoKey(p, c)] || fot[fotoKey(p, "")]; return f && f.asset ? f.asset : ""; };
const productos = {}, fotos = new Set();
Object.values(vars).forEach(v => {
  if (v.disp <= 0 || !v.producto) return;
  v.docs.sort((a, b) => a.ingreso.localeCompare(b.ingreso) || a.id.localeCompare(b.id));
  const p = prd[slug(v.producto)] || {}, own = v.docs.map(d => d.precio).filter(Boolean);
  const pm = p.porModelo && v.modelo ? num(p.porModelo[v.modelo]) : 0, gen = num(p.precio);
  const precio = own.length ? own[own.length - 1] : pm || gen;
  if (!precio) return; // sin precio no se publica
  const pid = slug(v.producto);
  const o = productos[pid] = productos[pid] || {id: pid, nombre: p.nombre || v.producto, categoria: p.categoria || v.categoria, precio: gen || precio, foto: fotoDe(v.producto, ""), colores: {}, items: []};
  const fc = fotoDe(v.producto, v.color); if (v.color) o.colores[v.color] = fc; if (fc) fotos.add(fc); if (o.foto) fotos.add(o.foto);
  o.items.push({modelo: v.modelo, color: v.color, precio});
});
const lista = Object.values(productos).map(o => { o.items.sort((a, b) => a.modelo.localeCompare(b.modelo, "es", {numeric: true}) || a.color.localeCompare(b.color));
  o.desde = Math.min(...o.items.map(i => i.precio)); return o; }).sort((a, b) => a.nombre.localeCompare(b.nombre));

const tasas = cfg.tasas || {}, t3 = num(tasas["Link MP 3 cuotas s/int"] != null ? tasas["Link MP 3 cuotas s/int"] : cfg.tasaLink) / 100;
const out = {
  actualizado: new Date().toISOString(),
  negocio: cfg.negocio || "Meraki",
  whatsapp: String(cfg.whatsapp || "").replace(/\D/g, ""),
  instagram: String(cfg.instagram || "").replace(/^@/, "").trim(),
  cuotas3: t3 > 0 && t3 < 1 ? t3 : 0,
  escalas: escalas.filter(e => num(e.precio) > 0).map(e => ({precio: num(e.precio), packs: (e.packs || []).filter(p => num(p.cant) > 1 && num(p.precio) > 0).map(p => ({cant: num(p.cant), precio: num(p.precio)}))})),
  combos: combos.filter(c => num(c.precio) > 0 && (c.cats || []).length > 1).map(c => ({cats: c.cats, precio: num(c.precio)})),
  productos: lista,
};
fs.mkdirSync(outDir, {recursive: true});
fs.writeFileSync(path.join(outDir, "catalogo.json"), JSON.stringify(out));
fs.writeFileSync(path.join(outDir, "fotos-necesarias.txt"), [...fotos].join("\n") + (fotos.size ? "\n" : ""));
console.log(`OK: ${lista.length} productos, ${lista.reduce((a, o) => a + o.items.length, 0)} variantes disponibles, ${fotos.size} fotos.`);
