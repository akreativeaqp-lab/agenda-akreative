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

  // Supabase devuelve TIME como HH:MM:SS y la agenda usa HH:MM.
  function normalizarHora(hora){
    return String(hora || "").slice(0,5);
  }

  // Identificador lógico de una reserva. Sirve para reconocer la misma reserva
  // aunque venga de Supabase o del almacenamiento local.
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
    const res = await fetch(`${API}?select=id,created_at,cliente,fecha,hora_inicio,hora_fin,tipo,estado&order=fecha.asc,hora_inicio.asc`, {
      headers: headers(),
      cache: "no-store"
    });
    if(!res.ok) throw new Error(`Supabase SELECT ${res.status}: ${await res.text()}`);
    return await res.json();
  }

  async function insertRows(rows){
    if(!rows.length) return [];
    const res = await fetch(API, {
      method: "POST",
      headers: headers({"Prefer":"return=representation"}),
      body: JSON.stringify(rows),
      cache: "no-store"
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

  // SINCRONIZACIÓN: solo descarga desde Supabase.
  // Ya no recorre todas las reservas locales para volver a insertarlas cada 30 s.
  // Esto elimina la fuente de las copias repetidas que vimos en la tabla.
  async function sincronizar(){
    if(syncing) return;
    syncing=true;
    try{
      const locales=leerReservasLocales().slice();
      const remotos=await getRemote();

      const mapaPagos=new Map(locales.map(r=>[
        key(r),
        {precio:r.precio??280,adelanto:r.adelanto??0}
      ]));

      const nuevasLocales=remotos.map(r=>{
        const local=remoteToLocal(r);
        const pago=mapaPagos.get(key(local));
        return pago ? Object.assign(local,pago) : local;
      });

      // Evitamos que una misma reserva aparezca varias veces en la agenda local
      // aunque todavía existan copias antiguas en Supabase.
      const unicas=[];
      const vistas=new Set();
      for(const r of nuevasLocales){
        const k=key(r);
        if(vistas.has(k)) continue;
        vistas.add(k);
        unicas.push(r);
      }

      escribirReservasLocales(unicas);
      window.reservas=unicas;
      if(typeof window.render==="function") window.render();
      localStorage.setItem("akreative_reservas", JSON.stringify(unicas));
      mostrarEstado(true,`☁️ Supabase conectado · ${unicas.length}`);
      console.log("AKREATIVE: Supabase conectado. Reservas únicas visibles:", unicas.length);
    }catch(err){
      console.error("AKREATIVE Supabase:",err);
      mostrarEstado(false,"⚠️ Supabase sin conexión");
    }finally{
      syncing=false;
    }
  }

  // Guarda SOLO las reservas que realmente aparecieron nuevas en el dispositivo.
  // Ya no intenta subir toda la agenda local en cada sincronización.
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

      if(faltantes.length){
        await insertRows(faltantes);
      }

      await sincronizar();
    }catch(err){
      console.error("AKREATIVE Supabase guardado:",err);
      mostrarEstado(false,"⚠️ No se pudo guardar en Supabase");
    }finally{
      savingToRemote=false;
    }
  }

  function envolverGuardar(){
    if(typeof window.guardarReserva!=="function") return false;
    const original=window.guardarReserva;
    if(original.__akSupabaseWrapped) return true;

    const wrapped=function(){
      // Tomamos una foto de las reservas antes de guardar.
      const antes=new Set(leerReservasLocales().map(key));

      original.apply(this,arguments);

      // Esperamos a que la función original termine de actualizar reservas.
      setTimeout(()=>{
        const despues=leerReservasLocales();
        const nuevas=despues.filter(r=>{
          if(!r.fecha || !r.inicio || !r.fin) return false;
          return !antes.has(key(r));
        });
        if(nuevas.length) guardarNuevas(nuevas);
      },200);
    };

    wrapped.__akSupabaseWrapped=true;
    window.guardarReserva=wrapped;
    return true;
  }

  function iniciar(){
    envolverGuardar();
    sincronizar();

    // Solo sincroniza lectura cada 30 segundos. También intenta envolver
    // guardarReserva por si la agenda principal la define después de este script.
    setInterval(()=>{
      envolverGuardar();
      sincronizar();
    },30000);
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
