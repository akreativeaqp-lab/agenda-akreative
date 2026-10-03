(function(){
  const SUPABASE_URL = "https://mlhcdekynqjitalxbsbr.supabase.co";
  const SUPABASE_KEY = "sb_publishable_i9OtR_vo0mHWXFm23w4B4A_x0PX0JqF";
  const TABLE = "sesiones";
  const API = `${SUPABASE_URL}/rest/v1/${TABLE}`;

  let syncing = false;
  let savingToRemote = false;

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
    }catch(e){
      return [];
    }
  }

  function escribirReservasLocales(rows){
    try{
      window.eval("reservas = " + JSON.stringify(rows) + ";");
      return true;
    }catch(e){
      console.error("AKREATIVE: no se pudo actualizar reservas locales", e);
      return false;
    }
  }

  // IMPORTANTE: Supabase devuelve TIME como HH:MM:SS y la agenda local usa HH:MM.
  // Normalizamos ambos formatos para que una misma reserva nunca se considere nueva.
  function normalizarHora(hora){
    return String(hora || "").slice(0,5);
  }

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
      id: Number(r.id),
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
    const res = await fetch(`${API}?select=id,created_at,cliente,fecha,hora_inicio,hora_fin,tipo,estado&order=fecha.asc,hora_inicio.asc`, {headers: headers(), cache:"no-store"});
    if(!res.ok) throw new Error(`Supabase SELECT ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  async function insertRows(rows){
    if(!rows.length) return [];
    const res = await fetch(API, {
      method:"POST",
      headers: headers({"Prefer":"return=representation"}),
      body: JSON.stringify(rows),
      cache:"no-store"
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
      const locales=leerReservasLocales().slice();
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
      const nuevasLocales=remotos.map(r=>{
        const local=remoteToLocal(r);
        const pago=mapaPagos.get(key(local));
        return pago ? Object.assign(local,pago) : local;
      });

      escribirReservasLocales(nuevasLocales);
      window.reservas=nuevasLocales;
      if(typeof window.render==="function") window.render();
      localStorage.setItem("akreative_reservas", JSON.stringify(nuevasLocales));
      mostrarEstado(true,`☁️ Supabase conectado · ${nuevasLocales.length}`);
      console.log("AKREATIVE: Supabase conectado. Reservas:", nuevasLocales.length);
    }catch(err){
      console.error("AKREATIVE Supabase:",err);
      mostrarEstado(false,"⚠️ Supabase sin conexión");
    }finally{
      syncing=false;
    }
  }

  async function sincronizarNuevas(){
    if(savingToRemote) return;
    savingToRemote=true;
    try{
      const remotos=await getRemote();
      const existentes=new Set(remotos.map(key));
      const locales=leerReservasLocales();
      const faltantes=[];

      for(const r of locales){
        if(!r.fecha || !r.inicio || !r.fin) continue;
        if(!existentes.has(key(r))){
          faltantes.push(localToRemote(r));
          existentes.add(key(r));
        }
      }

      if(faltantes.length){
        await insertRows(faltantes);
        await sincronizar();
      }
    }catch(err){
      console.error("AKREATIVE Supabase guardado:",err);
      mostrarEstado(false,"⚠️ No se pudo guardar en Supabase");
    }finally{
      savingToRemote=false;
    }
  }

  function envolverGuardar(){
    if(typeof window.guardarReserva!=="function") return;
    const original=window.guardarReserva;
    if(original.__akSupabaseWrapped) return;

    const wrapped=function(){
      original.apply(this,arguments);
      setTimeout(sincronizarNuevas,150);
    };
    wrapped.__akSupabaseWrapped=true;
    window.guardarReserva=wrapped;
  }

  function iniciar(){
    envolverGuardar();
    sincronizar();
    setInterval(sincronizar,30000);
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
