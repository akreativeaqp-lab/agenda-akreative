(function(){
  const SUPABASE_URL = "https://mlhcdekynqjitalxbsbr.supabase.co";
  const SUPABASE_KEY = "sb_publishable_i9OtR_vo0mHWXFm23w4B4A_x0PX0JqF";
  const TABLE = "sesiones";
  const API = `${SUPABASE_URL}/rest/v1/${TABLE}`;

  let syncing = false;
  let savingToRemote = false;
  let writingSyncSnapshot = false;

  function headers(extra={}){
    return Object.assign({
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json"
    }, extra);
  }

  function leerReservasLocales(){
    try{
      return window.eval("Array.isArray(reservas) ? reservas : []");
    }catch(e){ return []; }
  }

  function normalizarHora(hora){ return String(hora || "").slice(0,5); }

  function key(r){
    return [
      r.nombre || r.cliente || "",
      r.fecha || "",
      normalizarHora(r.inicio || r.hora_inicio),
      normalizarHora(r.fin || r.hora_fin)
    ].join("|").toLowerCase();
  }

  function remoteToLocal(r){
    return {
      id: r.id,
      nombre: r.cliente || r.nombre || "Sesión Fotográfica",
      fecha: r.fecha,
      inicio: normalizarHora(r.hora_inicio),
      fin: normalizarHora(r.hora_fin),
      precio: 280,
      adelanto: 0
    };
  }

  function localToRemote(r){
    return {
      cliente: r.nombre || "Sesión Fotográfica",
      fecha: r.fecha,
      hora_inicio: normalizarHora(r.inicio),
      hora_fin: normalizarHora(r.fin),
      tipo: "Sesión Fotográfica",
      estado: "reservado"
    };
  }

  async function getRemote(){
    const res = await fetch(`${API}?select=id,created_at,cliente,fecha,hora_inicio,hora_fin,tipo,estado&order=fecha.asc,hora_inicio.asc`, {
      headers: headers(), cache:"no-store"
    });
    if(!res.ok) throw new Error(`Supabase SELECT ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  async function insertRows(rows){
    if(!rows.length) return [];
    const res = await fetch(API, {
      method:"POST",
      headers:headers({"Prefer":"return=representation"}),
      body:JSON.stringify(rows), cache:"no-store"
    });
    if(!res.ok) throw new Error(`Supabase INSERT ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  async function deleteRemoteIds(ids){
    const unique=[...new Set(ids.map(id=>String(id)).filter(Boolean))];
    for(const id of unique){
      const res=await fetch(`${API}?id=eq.${encodeURIComponent(id)}`, {
        method:"DELETE",
        headers:headers({"Prefer":"return=minimal"}),
        cache:"no-store"
      });
      if(!res.ok) throw new Error(`Supabase DELETE ${res.status}: ${await res.text()}`);
    }
  }

  function mostrarEstado(ok,texto){
    let el=document.getElementById("supabaseEstado");
    if(!el){
      el=document.createElement("div"); el.id="supabaseEstado";
      el.style.cssText="position:fixed;right:10px;bottom:10px;z-index:9999;padding:7px 11px;border-radius:999px;font:700 11px Arial,sans-serif;background:#111;color:#fff;border:1px solid #333;box-shadow:0 4px 18px rgba(0,0,0,.35);opacity:.9;";
      document.body.appendChild(el);
    }
    el.textContent=texto;
    el.style.background=ok?"#063b20":"#4a1015";
    el.style.borderColor=ok?"#00b956":"#e51d2a";
  }

  // Detecta eliminaciones hechas por la propia agenda.
  // Si una reserva con un ID de Supabase desaparece del almacenamiento local,
  // se elimina también en Supabase. Las escrituras hechas por nuestra propia
  // sincronización quedan marcadas para no provocar borrados accidentales.
  function instalarDetectorDeBorrado(){
    const originalSetItem=Storage.prototype.setItem;
    if(originalSetItem.__akDeleteHook) return;

    function wrappedSetItem(storage,keyName,value){
      let anterior=[];
      let nuevo=[];
      if(keyName === "akreative_reservas" && !writingSyncSnapshot){
        try{ anterior=JSON.parse(storage.getItem(keyName)||"[]"); }catch(e){ anterior=[]; }
        try{ nuevo=JSON.parse(value||"[]"); }catch(e){ nuevo=[]; }
      }

      originalSetItem.call(this,keyName,value);

      if(keyName === "akreative_reservas" && !writingSyncSnapshot){
        const ahoraIds=new Set(nuevo.map(r=>Number(r.id)).filter(Number.isFinite));
        const borrados=anterior
          .filter(r=>Number.isFinite(Number(r.id)) && !ahoraIds.has(Number(r.id)))
          .map(r=>Number(r.id));

        if(borrados.length){
          guardarBorradosPendientes(borrados);
          deleteRemoteIds(borrados)
            .then(()=>{
              quitarBorradosPendientes(borrados);
              mostrarEstado(true,"☁️ Reserva eliminada en Supabase");
            })
            .catch(err=>{
              console.error("AKREATIVE Supabase DELETE:",err);
              mostrarEstado(false,"⚠️ Borrado pendiente de sincronizar");
            });
        }
      }
    }

    wrappedSetItem.__akDeleteHook=true;
    Storage.prototype.setItem=wrappedSetItem;
  }

  function leerBorradosPendientes(){
    try{
      const v=JSON.parse(localStorage.getItem("akreative_borrados_pendientes") || "[]");
      return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
    }catch(e){ return []; }
  }

  function guardarBorradosPendientes(ids){
    const actuales=leerBorradosPendientes();
    const todos=[...new Set([...actuales,...ids.map(String).filter(Boolean)])];
    localStorage.setItem("akreative_borrados_pendientes",JSON.stringify(todos));
  }

  function quitarBorradosPendientes(ids){
    const eliminar=new Set(ids.map(String));
    const restantes=leerBorradosPendientes().filter(id=>!eliminar.has(String(id)));
    localStorage.setItem("akreative_borrados_pendientes",JSON.stringify(restantes));
  }

  async function procesarBorradosPendientes(){
    const pendientes=leerBorradosPendientes();
    if(!pendientes.length) return;
    await deleteRemoteIds(pendientes);
    quitarBorradosPendientes(pendientes);
  }

  async function sincronizar(){
    if(syncing) return;
    syncing=true;
    try{
      await procesarBorradosPendientes();
      const locales=leerReservasLocales().slice();
      const remotos=await getRemote();
      const mapaPagos=new Map(locales.map(r=>[key(r),{precio:r.precio??280,adelanto:r.adelanto??0}]));

      const nuevasLocales=remotos.map(r=>{
        const local=remoteToLocal(r);
        const pago=mapaPagos.get(key(local));
        return pago ? Object.assign(local,pago) : local;
      });

      const unicas=[];
      const vistas=new Set();
      for(const r of nuevasLocales){
        const k=key(r);
        if(vistas.has(k)) continue;
        vistas.add(k); unicas.push(r);
      }

      writingSyncSnapshot=true;
      try{
        window.eval("reservas = " + JSON.stringify(unicas) + ";");
        window.reservas=unicas;
        localStorage.setItem("akreative_reservas",JSON.stringify(unicas));
      }finally{
        writingSyncSnapshot=false;
      }

      if(typeof window.render==="function") window.render();
      mostrarEstado(true,`☁️ Supabase conectado · ${unicas.length}`);
    }catch(err){
      console.error("AKREATIVE Supabase:",err);
      mostrarEstado(false,"⚠️ Supabase sin conexión");
    }finally{ syncing=false; }
  }

  async function guardarNuevas(nuevas){
    if(!nuevas.length || savingToRemote) return;
    savingToRemote=true;
    try{
      const remotos=await getRemote();
      const existentes=new Set(remotos.map(key));
      const faltantes=[];
      for(const r of nuevas){
        if(!r.fecha || !r.inicio || !r.fin) continue;
        const k=key(r);
        if(existentes.has(k)) continue;
        faltantes.push(localToRemote(r));
        existentes.add(k);
      }
      if(faltantes.length) await insertRows(faltantes);
      await sincronizar();
    }catch(err){
      console.error("AKREATIVE Supabase guardado:",err);
      mostrarEstado(false,"⚠️ No se pudo guardar en Supabase");
    }finally{ savingToRemote=false; }
  }

  function envolverGuardar(){
    if(typeof window.guardarReserva!=="function") return false;
    const original=window.guardarReserva;
    if(original.__akSupabaseWrapped) return true;

    const wrapped=function(){
      const antes=new Set(leerReservasLocales().map(key));
      original.apply(this,arguments);
      setTimeout(()=>{
        const despues=leerReservasLocales();
        const nuevas=despues.filter(r=>r.fecha&&r.inicio&&r.fin&&!antes.has(key(r)));
        if(nuevas.length) guardarNuevas(nuevas);
      },200);
    };
    wrapped.__akSupabaseWrapped=true;
    window.guardarReserva=wrapped;
    return true;
  }

  function iniciar(){
    instalarDetectorDeBorrado();
    envolverGuardar();
    sincronizar();
    setInterval(()=>{ envolverGuardar(); sincronizar(); },30000);
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",iniciar);
  else iniciar();
})();
