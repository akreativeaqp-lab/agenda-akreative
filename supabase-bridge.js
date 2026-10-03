(function(){
  const SUPABASE_URL = "https://mlhcdekynqjitalxbsbr.supabase.co";
  const SUPABASE_KEY = "sb_publishable_i9OtR_vo0mHWXFm23w4B4A_x0PX0JqF";
  const TABLE = "sesiones";
  const API = `${SUPABASE_URL}/rest/v1/${TABLE}`;

  let syncing = false;

  function headers(extra={}){
    return Object.assign({
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json"
    }, extra);
  }

  function key(r){
    return [r.nombre || r.cliente || "", r.fecha || "", r.inicio || r.hora_inicio || "", r.fin || r.hora_fin || ""].join("|").toLowerCase();
  }

  function remoteToLocal(r){
    return {
      id: Number(r.id),
      nombre: r.cliente || r.nombre || "Sesión Fotográfica",
      fecha: r.fecha,
      inicio: String(r.hora_inicio || "").slice(0,5),
      fin: String(r.hora_fin || "").slice(0,5),
      precio: 280,
      adelanto: 0
    };
  }

  function localToRemote(r){
    return {
      cliente: r.nombre || "Sesión Fotográfica",
      fecha: r.fecha,
      hora_inicio: r.inicio,
      hora_fin: r.fin,
      tipo: "Sesión Fotográfica",
      estado: "reservado"
    };
  }

  async function getRemote(){
    const res = await fetch(`${API}?select=id,created_at,cliente,fecha,hora_inicio,hora_fin,tipo,estado&order=fecha.asc,hora_inicio.asc`, {headers: headers()});
    if(!res.ok) throw new Error(`Supabase SELECT ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  async function insertRows(rows){
    if(!rows.length) return [];
    const res = await fetch(API, {
      method:"POST",
      headers: headers({"Prefer":"return=representation"}),
      body: JSON.stringify(rows)
    });
    if(!res.ok) throw new Error(`Supabase INSERT ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  function mostrarEstado(ok, texto){
    let el=document.getElementById("supabaseEstado");
    if(!el){
      el=document.createElement("div");
      el.id="supabaseEstado";
      el.style.cssText="position:fixed;right:10px;bottom:10px;z-index:9999;padding:7px 11px;border-radius:999px;font:700 11px Arial,sans-serif;background:#111;color:#fff;border:1px solid #333;box-shadow:0 4px 18px rgba(0,0,0,.35);opacity:.9;";
      document.body.appendChild(el);
    }
    el.textContent=texto;
    el.style.background=ok?"#063b20":"#4a1015";
    el.style.borderColor=ok?"#00b956":"#e51d2a";
  }

  async function sincronizar(){
    if(syncing) return;
    syncing=true;
    try{
      const locales=Array.isArray(window.reservas)?window.reservas.slice():[];
      let remotos=await getRemote();
      const existentes=new Set(remotos.map(key));
      const faltantes=[];

      for(const r of locales){
        if(!r.fecha || !r.inicio || !r.fin) continue;
        if(!existentes.has(key(r))){
          faltantes.push(localToRemote(r));
          existentes.add(key(r));
        }
      }

      if(faltantes.length) await insertRows(faltantes);
      remotos=await getRemote();

      const mapaPagos=new Map(locales.map(r=>[key(r),{precio:r.precio??280,adelanto:r.adelanto??0}]));
      window.reservas=remotos.map(r=>{
        const local=remoteToLocal(r);
        const pago=mapaPagos.get(key(local));
        return pago ? Object.assign(local,pago) : local;
      });
      if(typeof window.render==="function") window.render();
      localStorage.setItem("akreative_reservas", JSON.stringify(window.reservas));
      mostrarEstado(true,"☁️ Supabase conectado");
      console.log("AKREATIVE: Supabase conectado. Reservas:", window.reservas.length);
    }catch(err){
      console.error("AKREATIVE Supabase:",err);
      mostrarEstado(false,"⚠️ Supabase sin conexión");
    }finally{
      syncing=false;
    }
  }

  async function sincronizarNuevas(){
    try{
      const remotos=await getRemote();
      const existentes=new Set(remotos.map(key));
      const locales=Array.isArray(window.reservas)?window.reservas:[];
      const faltantes=locales.filter(r=>r.fecha&&r.inicio&&r.fin&&!existentes.has(key(r))).map(localToRemote);
      if(faltantes.length){
        await insertRows(faltantes);
        await sincronizar();
      }
    }catch(err){
      console.error("AKREATIVE Supabase guardado:",err);
      mostrarEstado(false,"⚠️ No se pudo guardar en Supabase");
    }
  }

  function envolverGuardar(){
    if(typeof window.guardarReserva!=="function") return;
    const original=window.guardarReserva;
    window.guardarReserva=function(){
      original.apply(this,arguments);
      setTimeout(sincronizarNuevas,50);
    };
  }

  function iniciar(){
    envolverGuardar();
    sincronizar();
    setInterval(sincronizar,30000);
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
