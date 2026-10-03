(function(){
  // Evita que registros idénticos de Supabase se dibujen varias veces en la agenda.
  // No modifica la base de datos: solo limpia la respuesta que recibe la agenda.
  const originalFetch = window.fetch.bind(window);

  function clave(r){
    return [
      r.cliente || r.nombre || "",
      r.fecha || "",
      String(r.hora_inicio || r.inicio || "").slice(0,5),
      String(r.hora_fin || r.fin || "").slice(0,5)
    ].join("|").trim().toLowerCase();
  }

  window.fetch = async function(input, init){
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();

    const esSesiones = url.includes("/rest/v1/sesiones") && method === "GET";
    const response = await originalFetch(input, init);

    if(!esSesiones || !response.ok) return response;

    try{
      const datos = await response.clone().json();
      if(!Array.isArray(datos)) return response;

      const vistos = new Set();
      const unicos = [];

      for(const r of datos){
        // La fila PRUEBA fue creada durante la configuración y no es una reserva real.
        const cliente = String(r.cliente || r.nombre || "").trim().toUpperCase();
        if(cliente === "PRUEBA") continue;

        const k = clave(r);
        if(vistos.has(k)) continue;
        vistos.add(k);
        unicos.push(r);
      }

      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      headers.set("content-type","application/json");

      return new Response(JSON.stringify(unicos), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }catch(e){
      console.error("AKREATIVE: error limpiando respuesta Supabase", e);
      return response;
    }
  };
})();