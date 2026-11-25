'use strict';
(() => {
  const TILES = 'https://tiles.mapgenie.io/games/';
  // cada pasta (ex.: /biel/ e /pai/) guarda o próprio progresso, mesmo no mesmo aparelho
  const P = 'gta6:' + location.pathname.replace(/[^/]*$/, '') + ':';
  const CHAVE_FEITOS = P + 'feitos';
  const CHAVE_OCULTAS = P + 'ocultas';
  const CHAVE_MODO = P + 'modo';
  const CHAVE_ESC_FEITOS = P + 'esconder-feitos';
  const OCULTAS_PADRAO = ['Bus Stop', 'Electric Charger', 'ATM', 'Random Event', 'Vehicle Spawn', 'Weapon Pickup'];
  const CHAVE_FECHADAS = P + 'secoes-fechadas';
  const CHAVE_SO = P + 'so'; // modo "só esta categoria": {c, antes: [ocultas de antes]}
  const CHAVE_VISTA = P + 'vista-progresso';
  const SPRITE = new Image();
  SPRITE.src = 'icones/mapa.png';

  const $ = (s) => document.querySelector(s);
  const ler = (k, padrao) => { try { const v = localStorage.getItem(k); return v === null ? padrao : JSON.parse(v); } catch { return padrao; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { aviso('Não deu para salvar neste aparelho.'); } };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  let D, mapa, camada, grupoPontos, selecao, atual = null;
  const porId = new Map(), catPorId = new Map(), grupoPorId = new Map(), secaoPorId = new Map();
  const locaisPorCat = new Map();
  let fechadas = new Set(ler(CHAVE_FECHADAS, []));
  const conta = (c) => secaoPorId.get(grupoPorId.get(c.g).s).conta; // categoria que vale progresso
  const marcavel = (l) => conta(catPorId.get(l.c)); // só Coleções e Atividades dão para marcar (como no MapGenie)
  let feitos = new Set(ler(CHAVE_FEITOS, []));
  let ocultas = null; // Set de ids de categoria
  let esconderFeitos = ler(CHAVE_ESC_FEITOS, false);
  let modo = ler(CHAVE_MODO, 'Day');
  let so = ler(CHAVE_SO, null);
  let vista = ler(CHAVE_VISTA, 'tipo');

  // marcador: ícone do MapGenie desenhado no canvas; feito = apagado + selo verde com check
  const Ponto = L.CircleMarker.extend({
    _updatePath() {
      if (!SPRITE.complete || !SPRITE.naturalWidth) return;
      const ctx = this._renderer._ctx, p = this._point, r = this._radius, o = this.options;
      const t = D.icones.mapa, n = D.icones.colunas;
      ctx.globalAlpha = o.feito ? .45 : 1;
      ctx.drawImage(SPRITE, (o.ic % n) * t, Math.floor(o.ic / n) * t, t, t, p.x - r, p.y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
      if (o.feito) {
        const br = Math.max(4, r * .48), bx = p.x + r * .62, by = p.y + r * .62;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = '#2BC48A'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#0E1430'; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bx - br * .5, by); ctx.lineTo(bx - br * .12, by + br * .4); ctx.lineTo(bx + br * .52, by - br * .38);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, br * .32); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }
  });

  const Camada = L.TileLayer.extend({
    getTileUrl(c) {
      return TILES + this.options.padrao.replace('{z}', c.z).replace('{x}', c.x).replace('{y}', c.y);
    }
  });

  function raio() {
    const z = mapa.getZoom();
    return z <= 8.5 ? 7 : z <= 9.5 ? 9 : z <= 10.5 ? 11 : z <= 11.5 ? 13 : 15;
  }

  function estilo(l) {
    return { radius: raio(), ic: catPorId.get(l.c).ic, feito: marcavel(l) && feitos.has(l.id), weight: 0, bubblingMouseEvents: false };
  }

  // ícone da lista (folha icones/lista.png)
  function ico(c) {
    const n = D.icones.colunas;
    return `<span class="ico" aria-hidden="true" style="--ix:${c.ic % n};--iy:${Math.floor(c.ic / n)}"></span>`;
  }

  // ---------- dados ----------
  async function iniciar() {
    const r = await fetch('dados.json');
    D = await r.json();
    D.secoes.forEach((s) => secaoPorId.set(s.id, s));
    D.grupos.forEach((g) => grupoPorId.set(g.id, g));
    document.documentElement.style.setProperty('--ic-cols', D.icones.colunas);
    D.categorias.forEach((c) => { catPorId.set(c.id, c); locaisPorCat.set(c.id, []); });
    D.locais.forEach((l) => { porId.set(l.id, l); locaisPorCat.get(l.c).push(l); l._busca = norm(l.t + (l.tg ? ' ' + l.tg : '')); });
    const salvas = ler(CHAVE_OCULTAS, null);
    ocultas = new Set(salvas || D.categorias.filter((c) => OCULTAS_PADRAO.includes(c.en)).map((c) => c.id));
    // limpa ids que não existem mais
    feitos = new Set([...feitos].filter((id) => porId.has(id) && marcavel(porId.get(id))));

    montarMapa();
    if (so && !catPorId.has(so.c)) so = null;
    montarFiltros();
    pintarSo();
    atualizarProgresso();
    ligarEventos();
    if (!importarDeTexto(location.hash)) abrirDoHash();
    iniciarNuvem();
  }

  // ---------- nuvem (Firebase): mesmo progresso em todos os aparelhos logados na mesma conta Google ----------
  // a chave abaixo é pública por natureza (identifica o projeto); quem protege os dados são as regras do Firestore
  const FB = {
    apiKey: 'AIzaSyB8-Y6EUNe7f3-v5BF5RhhE3250X87ZyZ4',
    authDomain: 'mapa-leonida-32340.firebaseapp.com',
    projectId: 'mapa-leonida-32340',
    appId: '1:429313019859:web:4e04d0bf07b3159b63e926',
  };
  const FB_V = '10.12.2';
  const PASTA = (location.pathname.replace(/[^/]*$/, '').split('/').filter(Boolean).pop() || 'raiz').replace(/[^\w-]/g, '');
  const CHAVE_UID = P + 'nuvem-uid'; // conta que já juntou o progresso deste aparelho
  let fbAuth = null, docNuvem = null, pararNuvem = null, tNuvem;

  function salvarFeitos() {
    gravar(CHAVE_FEITOS, [...feitos]);
    if (!docNuvem) return;
    clearTimeout(tNuvem);
    tNuvem = setTimeout(() => {
      docNuvem.set({ feitos: [...feitos], em: Date.now() }).catch(() => {});
    }, 800);
  }

  function carregarScript(src) {
    return new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = erro;
      document.head.appendChild(s);
    });
  }

  function pintarConta(user, estado) {
    const b = $('#btn-nuvem'), t = $('#nuvem-status');
    if (!b) return;
    if (estado === 'off') {
      b.textContent = 'Entrar com Google';
      b.disabled = true;
      t.textContent = 'Sem internet agora. Seu progresso continua salvo neste aparelho.';
      return;
    }
    b.disabled = false;
    if (user) {
      b.textContent = 'Sair da conta';
      b.classList.add('btn-2');
      t.textContent = `Sincronizando com ${user.email || 'sua conta Google'}. O que marcar aqui aparece nos outros aparelhos.`;
    } else {
      b.textContent = 'Entrar com Google';
      b.classList.remove('btn-2');
      t.textContent = 'Entre com a mesma conta Google no celular e no PC para o progresso aparecer nos dois sozinho.';
    }
  }

  async function iniciarNuvem() {
    try {
      const base = `https://www.gstatic.com/firebasejs/${FB_V}/`;
      await carregarScript(base + 'firebase-app-compat.js');
      await Promise.all([carregarScript(base + 'firebase-auth-compat.js'), carregarScript(base + 'firebase-firestore-compat.js')]);
    } catch {
      pintarConta(null, 'off');
      return;
    }
    firebase.initializeApp(FB);
    fbAuth = firebase.auth();
    const db = firebase.firestore();
    try { await db.enablePersistence({ synchronizeTabs: true }); } catch { /* sem cache offline neste navegador */ }
    fbAuth.getRedirectResult().catch(() => {});
    fbAuth.onAuthStateChanged((user) => {
      if (pararNuvem) { pararNuvem(); pararNuvem = null; }
      docNuvem = null;
      pintarConta(user);
      if (user) ligarNuvem(db, user);
    });
  }

  async function ligarNuvem(db, user) {
    const ref = db.collection('users').doc(user.uid).collection('mapas').doc(PASTA);
    // 1ª vez desta conta neste aparelho: junta o que já estava marcado aqui com o que está na nuvem
    if (ler(CHAVE_UID, null) !== user.uid) {
      try {
        const snap = await ref.get();
        const daNuvem = (snap.exists && snap.data().feitos) || [];
        const antes = feitos.size;
        daNuvem.forEach((id) => { if (porId.has(id) && marcavel(porId.get(id))) feitos.add(id); });
        docNuvem = ref;
        gravar(CHAVE_UID, user.uid);
        await ref.set({ feitos: [...feitos], em: Date.now() });
        gravar(CHAVE_FEITOS, [...feitos]);
        aplicarTudo();
        const novos = feitos.size - antes;
        aviso(novos ? `Conta ligada: ${novos} marcaç${novos > 1 ? 'ões vieram' : 'ão veio'} da nuvem.` : 'Conta ligada. Seu progresso está salvo na nuvem.');
      } catch {
        aviso('Não deu para ligar a conta agora. Tente de novo com internet.');
        return;
      }
    }
    docNuvem = ref;
    // depois disso a nuvem manda: o que mudar em outro aparelho (marcar ou desmarcar) chega aqui
    pararNuvem = ref.onSnapshot((snap) => {
      if (!snap.exists || snap.metadata.hasPendingWrites) return;
      const lista = (snap.data().feitos || []).filter((id) => porId.has(id) && marcavel(porId.get(id)));
      const igual = lista.length === feitos.size && lista.every((id) => feitos.has(id));
      if (igual) return;
      feitos = new Set(lista);
      gravar(CHAVE_FEITOS, [...feitos]);
      aplicarTudo();
    }, () => {});
  }

  async function botaoNuvem() {
    if (!fbAuth) return;
    if (fbAuth.currentUser) {
      if (!confirm('Sair da conta? O progresso continua neste aparelho, mas para de sincronizar.')) return;
      await fbAuth.signOut();
      localStorage.removeItem(CHAVE_UID);
      aviso('Você saiu da conta.');
      return;
    }
    const prov = new firebase.auth.GoogleAuthProvider();
    prov.setCustomParameters({ prompt: 'select_account' });
    try {
      await fbAuth.signInWithPopup(prov);
    } catch (e) {
      const c = e && e.code;
      if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
      // app instalado no iPhone às vezes bloqueia a janelinha: entra pela página inteira
      try { await fbAuth.signInWithRedirect(prov); } catch { aviso('Não deu para entrar agora. Tente de novo.'); }
    }
  }

  function montarMapa() {
    const limites = L.latLngBounds([0, -1.40625], [1.40625, 0]);
    mapa = L.map('mapa', {
      zoomControl: false, minZoom: 8, maxZoom: 17, zoomSnap: .5, wheelPxPerZoomLevel: 90,
      maxBounds: limites.pad(.1), maxBoundsViscosity: .8,
      renderer: L.canvas({ tolerance: 10, padding: .3 }),
      attributionControl: true
    });
    mapa.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    trocarModo(modo, true);
    const pts = D.locais.map((l) => [l.lat, l.lng]);
    mapa.fitBounds(L.latLngBounds(pts), { padding: [20, 20] });

    grupoPontos = L.layerGroup().addTo(mapa);
    D.locais.forEach((l) => {
      l._m = new Ponto([l.lat, l.lng], estilo(l));
      l._m.on('click', () => abrir(l.id, false));
    });
    selecao = L.circleMarker([0, 0], { radius: raio() + 6, color: '#FF3E8A', weight: 3, fill: false, interactive: false });
    desenharPontos();
    SPRITE.addEventListener('load', desenharPontos);
    mapa.on('zoomend', () => {
      const r = raio();
      D.locais.forEach((l) => l._m.setRadius(r));
      selecao.setRadius(r + 6);
    });
  }

  function trocarModo(m, primeira) {
    const ts = D.mapa.tile_sets.find((t) => t.name === m) || D.mapa.tile_sets[0];
    modo = ts.name;
    if (camada) mapa.removeLayer(camada);
    camada = new Camada('', {
      padrao: ts.pattern, minZoom: 8, maxZoom: 17, maxNativeZoom: ts.tiles_max_zoom,
      bounds: L.latLngBounds([0, -1.40625], [1.40625, 0]), referrerPolicy: 'no-referrer',
      attribution: 'Mapa © <a href="https://mapgenie.io/grand-theft-auto-6/maps/leonida">MapGenie</a>',
      keepBuffer: 3
    }).addTo(mapa);
    camada.bringToBack();
    $('#mapa').style.background = ts.bg || '#2f90b0';
    const noite = modo === 'Night';
    const b = $('#btn-dia');
    b.classList.toggle('noite', noite);
    b.setAttribute('aria-label', noite ? 'Trocar para mapa de dia' : 'Trocar para mapa noturno');
    b.innerHTML = noite
      ? '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>';
    if (!primeira) gravar(CHAVE_MODO, modo);
  }

  function visivel(l) {
    return !ocultas.has(l.c) && !(esconderFeitos && feitos.has(l.id));
  }

  function desenharPontos() {
    grupoPontos.clearLayers();
    D.locais.forEach((l) => { if (visivel(l)) grupoPontos.addLayer(l._m); });
  }

  // ---------- filtros ----------
  function montarFiltros() {
    const caixa = $('#lista-grupos');
    let h = '';
    D.secoes.forEach((s) => {
      const aberta = !fechadas.has(s.id);
      h += `<section class="secao" data-s="${s.id}">
        <button class="secao-cab" aria-expanded="${aberta}" aria-controls="sec-${s.id}"><h3>${esc(s.nome)}</h3>
        <svg class="ic seta" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
        <div class="secao-corpo" id="sec-${s.id}"${aberta ? '' : ' hidden'}>`;
      D.grupos.filter((g) => g.s === s.id).forEach((g) => {
        const cats = D.categorias.filter((c) => c.g === g.id).sort((a, b) => a.ordem - b.ordem);
        if (!cats.length) return;
        h += `<div class="grupo"><div class="grupo-cab"><h4>${esc(g.nome)}</h4>
          <button class="grupo-alt" data-g="${g.id}"></button></div><div class="cats">`;
        cats.forEach((c) => {
          h += `<button class="cat" data-c="${c.id}" aria-pressed="false">${ico(c)}<span class="cat-nome">${esc(c.nome)}</span><small></small></button>`;
        });
        h += '</div></div>';
      });
      h += '</div></section>';
    });
    caixa.innerHTML = h;
    $('#esconder-feitos').checked = esconderFeitos;
    pintarFiltros();
  }

  function pintarFiltros() {
    document.querySelectorAll('.cat').forEach((b) => {
      const id = +b.dataset.c, on = !ocultas.has(id);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      const ls = locaisPorCat.get(id), c = catPorId.get(id);
      if (conta(c)) {
        const f = ls.filter((l) => feitos.has(l.id)).length;
        b.querySelector('small').textContent = `${f}/${ls.length}`;
        b.classList.toggle('completa', f === ls.length);
      } else {
        b.querySelector('small').textContent = ls.length;
      }
    });
    document.querySelectorAll('.grupo-alt').forEach((b) => {
      const g = +b.dataset.g;
      const todas = D.categorias.filter((c) => c.g === g).every((c) => !ocultas.has(c.id));
      b.textContent = todas ? 'Esconder grupo' : 'Mostrar grupo';
    });
  }

  function mudouFiltro() {
    gravar(CHAVE_OCULTAS, [...ocultas]);
    pintarFiltros();
    desenharPontos();
  }

  // ---------- progresso ----------
  function atualizarProgresso() {
    // só Coleções e Atividades contam (Locais é referência, como no MapGenie)
    const valem = D.locais.filter((l) => conta(catPorId.get(l.c)));
    const total = valem.length, feitosN = valem.filter((l) => feitos.has(l.id)).length;
    const pct = total ? Math.round((feitosN / total) * 1000) / 10 : 0;
    const pctTxt = pct.toString().replace('.', ',');
    $('#progresso-mini').innerHTML = `<b>${feitosN}</b>/${total}<span>${pctTxt}% feito</span>`;
    $('#prog-total').innerHTML = `<div class="prog-total"><div class="num">${feitosN}<span>/${total}</span></div>
      <p>${pctTxt}% das coleções e atividades</p><div class="barra"><i style="width:${pct}%"></i></div></div>`;
    document.querySelectorAll('.seg').forEach((b) => {
      const on = b.dataset.vista === vista;
      b.classList.toggle('ativa', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('#prog-dica').textContent = vista === 'bairro'
      ? 'Toque num bairro para ir até ele no mapa.'
      : 'Toque numa linha para ver só ela no mapa.';
    $('#lista-progresso').innerHTML = vista === 'bairro' ? progressoBairros(valem) : progressoTipos();
  }

  function linhaProg(attr, icone, nome, f, t) {
    return `<button class="prog-c${f === t ? ' completo' : ''}${icone ? '' : ' sem-ico'}" ${attr}>${icone}<span>${esc(nome)}</span><b>${f}/${t}</b>
      <span class="barra"><i style="width:${t ? (f / t) * 100 : 0}%"></i></span></button>`;
  }

  // por bairro: agrupado pelos 5 condados, bairros em ordem alfabética
  function progressoBairros(valem) {
    const porCond = new Map();
    valem.forEach((l) => {
      if (!l.r) return;
      const cond = (D.condados && D.condados[l.r]) || l.r;
      if (!porCond.has(cond)) porCond.set(cond, new Map());
      const bs = porCond.get(cond);
      if (!bs.has(l.r)) bs.set(l.r, [0, 0]);
      const v = bs.get(l.r);
      v[1]++;
      if (feitos.has(l.id)) v[0]++;
    });
    const nome = (id) => D.regioes[id] || '';
    let h = '';
    [...porCond.keys()].sort((a, b) => nome(a).localeCompare(nome(b), 'pt-BR')).forEach((cond) => {
      const bs = porCond.get(cond);
      let gt = 0, gf = 0, linhas = '';
      [...bs.keys()].sort((a, b) => nome(a).localeCompare(nome(b), 'pt-BR')).forEach((r) => {
        const [f, t] = bs.get(r);
        gt += t; gf += f;
        linhas += linhaProg(`data-bairro="${r}"`, '', nome(r), f, t);
      });
      h += `<section class="prog-g"><h3>${esc(nome(cond))}<span>${gf}/${gt}</span></h3>${linhas}</section>`;
    });
    return h;
  }

  function progressoTipos() {
    let h = '';
    D.secoes.filter((s) => s.conta).forEach((s) => {
      D.grupos.filter((g) => g.s === s.id).forEach((g) => {
        const cats = D.categorias.filter((c) => c.g === g.id).sort((a, b) => a.ordem - b.ordem);
        let gt = 0, gf = 0, linhas = '';
        cats.forEach((c) => {
          const ls = locaisPorCat.get(c.id), t = ls.length, f = ls.filter((l) => feitos.has(l.id)).length;
          gt += t; gf += f;
          linhas += linhaProg(`data-so="${c.id}"`, ico(c), c.nome, f, t);
        });
        h += `<section class="prog-g"><h3>${esc(g.nome)}<span>${gf}/${gt}</span></h3>${linhas}</section>`;
      });
    });
    return h;
  }

  // ---------- só esta categoria ----------
  function soCategoria(id) {
    const antes = so ? so.antes : [...ocultas];
    so = { c: id, antes };
    ocultas = new Set(D.categorias.filter((c) => c.id !== id).map((c) => c.id));
    gravar(CHAVE_SO, so);
    mudouFiltro();
    pintarSo();
    const ls = locaisPorCat.get(id).filter(visivel);
    if (ls.length) mostrarArea(ls);
    else { fecharGaveta(); aviso(esconderFeitos ? 'Você já fez tudo desta categoria.' : 'Nada desta categoria no mapa.'); }
  }

  function sairDoSo() {
    if (!so) return;
    ocultas = new Set(so.antes);
    so = null;
    gravar(CHAVE_SO, null);
    mudouFiltro();
    pintarSo();
  }

  // mexeu no filtro na mão: o modo "só" acaba e fica o filtro novo
  function largarSo() {
    if (!so) return;
    so = null;
    gravar(CHAVE_SO, null);
    pintarSo();
  }

  function pintarSo() {
    $('#so-barra').hidden = !so;
    if (so) $('#so-nome').textContent = 'Só: ' + catPorId.get(so.c).nome;
    if (atual) pintarBotaoSo();
  }

  function pintarBotaoSo() {
    const c = catPorId.get(atual.c), ativo = so && so.c === c.id;
    $('#btn-so').textContent = ativo ? 'Mostrar o resto do mapa' : `Ver só ${c.nome} no mapa`;
  }

  // enquadra uma lista de locais no mapa
  function mostrarArea(ls) {
    fecharGaveta();
    if (atual) fecharCartao();
    mapa.stop();
    mapa.fitBounds(L.latLngBounds(ls.map((l) => [l.lat, l.lng])), { padding: [70, 40], maxZoom: 14, animate: true });
  }

  function irParaBairro(r) {
    const ls = D.locais.filter((l) => l.r === r && marcavel(l));
    if (!ls.length) return;
    const falta = ls.filter((l) => !feitos.has(l.id)).length;
    mostrarArea(ls);
    aviso(falta ? `${D.regioes[r]}: falta${falta > 1 ? 'm' : ''} ${falta}.` : `${D.regioes[r]}: tudo feito.`);
  }

  // ---------- cartão ----------
  function inline(s) {
    let t = esc(s);
    t = t.replace(/\|\|(.+?)\|\|/g, '<button class="spoiler" type="button" aria-label="Spoiler: toque para ver">$1</button>');
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) => {
      const id = /locationIds=(\d+)/.exec(url);
      if (id && porId.has(+id[1])) return `<a href="#${id[1]}" data-ir="${id[1]}">${txt}</a>`;
      if (/^https:\/\//.test(url.replace(/&amp;/g, '&'))) return `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
      return txt;
    });
    return t;
  }

  function descricao(d) {
    if (!d) return '';
    const out = [];
    let lista = null;
    d.split('\n').forEach((linha) => {
      const li = /^-\s+(.*)$/.exec(linha);
      if (li) { (lista = lista || []).push(`<li>${inline(li[1])}</li>`); return; }
      if (lista) { out.push(`<ul>${lista.join('')}</ul>`); lista = null; }
      if (!linha.trim()) return;
      out.push(/^\*\*[^*]+:\*\*/.test(linha) ? `<p class="campo">${inline(linha)}</p>` : `<p>${inline(linha)}</p>`);
    });
    if (lista) out.push(`<ul>${lista.join('')}</ul>`);
    return out.join('');
  }

  function abrir(id, centralizar = true) {
    const l = porId.get(id);
    if (!l) return;
    atual = l;
    const c = catPorId.get(l.c), g = grupoPorId.get(c.g);
    const cartao = $('#cartao');
    $('#cartao-cor').outerHTML = ico(c).replace('class="ico"', 'class="ico" id="cartao-cor"');
    $('#cartao-cat').textContent = `${c.nome} · ${g.nome}`;
    $('#cartao-titulo').textContent = l.t;
    const reg = [l.r ? D.regioes[l.r] : '', l.tg ? 'Especialidade: ' + l.tg : ''].filter(Boolean).join(' · ');
    $('#cartao-regiao').textContent = reg;
    $('#cartao-regiao').hidden = !reg;
    pintarFotos(l);
    $('#cartao-desc').innerHTML = descricao(l.d) || (c.info ? `<p>${esc(c.info)}</p>` : '');
    $('#btn-feito').hidden = !marcavel(l);
    pintarBotaoSo();
    pintarBotaoFeito();
    cartao.hidden = false;
    cartao.scrollTop = 0;
    fecharGaveta();
    selecao.setLatLng([l.lat, l.lng]).addTo(mapa);
    if (history.replaceState) history.replaceState(null, '', '#' + l.id);
    if (centralizar) irPara(l);
    else afastarDoCartao(l);
  }

  // fotos: fotos/<id>-<n>.webp na raiz do site, uma pasta só para os dois mapas
  const fotosDe = (l) => Array.from({ length: l.f || 0 }, (_, i) => `../fotos/${l.id}-${i + 1}.webp`);

  function pintarFotos(l) {
    const box = $('#cartao-fotos'), fs = fotosDe(l);
    box.hidden = !fs.length;
    box.scrollLeft = 0;
    box.innerHTML = fs.map((src, i) => `<button data-foto="${i}" aria-label="Ver foto ${i + 1} de ${fs.length}">
      <img src="${src}" alt="" loading="lazy" decoding="async" width="960" height="540"></button>`).join('');
  }

  function abrirVisor(i) {
    const fs = fotosDe(atual), v = $('#visor'), box = $('#visor-fotos');
    box.innerHTML = fs.map((src) => `<img src="${src}" alt="Foto de ${esc(atual.t)}">`).join('');
    v.hidden = false;
    const conta = () => { $('#visor-conta').textContent = fs.length > 1 ? `${Math.round(box.scrollLeft / box.clientWidth) + 1} de ${fs.length}` : ''; };
    box.scrollLeft = i * box.clientWidth;
    box.onscroll = conta;
    conta();
    $('#visor-fechar').focus();
  }

  function fecharVisor() {
    $('#visor').hidden = true;
    $('#visor-fotos').innerHTML = '';
  }

  function irPara(l) {
    mapa.stop();
    const z = Math.max(Math.round(mapa.getZoom()), 13);
    mapa.setView([l.lat, l.lng], z, { animate: false });
    afastarDoCartao(l);
  }

  // no celular, sobe o mapa para o ponto não ficar embaixo do cartão
  function afastarDoCartao(l) {
    if (window.innerWidth >= 900) return;
    const h = $('#cartao').offsetHeight;
    const p = mapa.latLngToContainerPoint([l.lat, l.lng]);
    const alvoY = (window.innerHeight - h) / 2;
    if (p.y > window.innerHeight - h - 30 || p.y < 80) mapa.panBy([0, p.y - alvoY], { animate: true });
  }

  function fecharCartao() {
    $('#cartao').hidden = true;
    atual = null;
    selecao.remove();
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
  }

  function pintarBotaoFeito() {
    const b = $('#btn-feito'), f = feitos.has(atual.id);
    b.classList.toggle('feito', f);
    b.textContent = f ? 'Feito  ✓  (toque para desmarcar)' : 'Marcar como feito';
  }

  function alternarFeito(l) {
    if (!marcavel(l)) return;
    if (feitos.has(l.id)) feitos.delete(l.id); else feitos.add(l.id);
    salvarFeitos();
    l._m.setStyle(estilo(l));
    if (esconderFeitos) desenharPontos();
    pintarFiltros();
    atualizarProgresso();
  }

  // ---------- busca ----------
  function buscar(q) {
    const lista = $('#resultados');
    $('#limpar-busca').hidden = !q;
    if (!q.trim()) { lista.hidden = true; lista.innerHTML = ''; return; }
    const termos = norm(q).split(/\s+/).filter(Boolean);
    const achados = [];
    for (const l of D.locais) {
      const c = catPorId.get(l.c);
      const texto = l._busca + ' ' + norm(c.nome) + ' ' + norm(c.en) + ' ' + (l.r ? norm(D.regioes[l.r]) : '');
      if (termos.every((t) => texto.includes(t))) {
        achados.push({ l, peso: termos.every((t) => l._busca.includes(t)) ? 0 : 1 });
        if (achados.length > 400) break;
      }
    }
    achados.sort((a, b) => a.peso - b.peso || a.l.t.localeCompare(b.l.t, 'pt-BR'));
    if (!achados.length) {
      lista.innerHTML = '<li class="res-vazio">Nada encontrado. Tente o nome do lugar, a categoria ou o bairro.</li>';
    } else {
      lista.innerHTML = achados.slice(0, 40).map(({ l }) => {
        const c = catPorId.get(l.c);
        const reg = (l.tg ? ' · ' + esc(l.tg) : '') + (l.r ? ' · ' + esc(D.regioes[l.r]) : '');
        return `<li><button data-ir="${l.id}">${ico(c)}
          <span class="res-txt"><span class="res-t">${esc(l.t)}</span><span class="res-s">${esc(c.nome)}${reg}</span></span>
          ${marcavel(l) && feitos.has(l.id) ? '<span class="res-feito">feito</span>' : ''}</button></li>`;
      }).join('') + (achados.length > 40 ? `<li class="res-vazio">Mostrando 40 de ${achados.length > 400 ? 'mais de 400' : achados.length}. Escreva mais para filtrar.</li>` : '');
    }
    lista.hidden = false;
  }

  // ---------- gaveta ----------
  function fecharGaveta() {
    $('#gaveta').classList.remove('aberta');
    $('#alca').setAttribute('aria-expanded', 'false');
  }

  function trocarAba(nome) {
    document.querySelectorAll('.aba').forEach((a) => {
      const on = a.dataset.aba === nome;
      a.classList.toggle('ativa', on);
      a.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.painel').forEach((p) => { p.hidden = p.dataset.painel !== nome; });
  }

  // ---------- backup ----------
  function baixarBackup() {
    const dados = { app: 'mapa-leonida', versao: 1, data: new Date().toISOString(), feitos: [...feitos] };
    const blob = new Blob([JSON.stringify(dados)], { type: 'application/json' });
    const a = document.createElement('a');
    const hoje = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(blob);
    a.download = `leonida-progresso-${hoje}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    aviso('Backup baixado.');
  }

  async function restaurarBackup(arquivo) {
    try {
      const j = JSON.parse(await arquivo.text());
      const lista = Array.isArray(j) ? j : j.feitos;
      if (!Array.isArray(lista)) throw new Error();
      const novos = lista.map(Number).filter((id) => porId.has(id) && marcavel(porId.get(id)));
      if (!confirm(`Trocar o progresso deste aparelho (${feitos.size} feitos) pelo do backup (${novos.length} feitos)?`)) return;
      feitos = new Set(novos);
      salvarFeitos();
      aplicarTudo();
      aviso(`Backup restaurado: ${novos.length} locais feitos.`);
    } catch {
      aviso('Esse arquivo não é um backup do mapa.');
    }
  }

  // link do progresso: ids em ordem, guardando só a diferença para o anterior, em base 36
  function codificar(ids) {
    let ant = 0;
    return [...ids].sort((a, b) => a - b).map((id) => { const d = id - ant; ant = id; return d.toString(36); }).join('.');
  }
  function linkDoProgresso() {
    return location.origin + location.pathname + '#p=' + codificar(feitos);
  }
  // aceita o link inteiro ou só o pedaço "#p=..."; soma ao que já está marcado, não apaga nada
  function importarDeTexto(txt) {
    const m = /[#&]p=([0-9a-z.]+)/i.exec(txt || '');
    if (!m) return false;
    let ant = 0;
    const ids = m[1].split('.').filter(Boolean).map((s) => (ant += parseInt(s, 36)))
      .filter((id) => porId.has(id) && marcavel(porId.get(id)));
    if (location.hash.includes('p=')) history.replaceState(null, '', location.pathname);
    const antes = feitos.size;
    ids.forEach((id) => feitos.add(id));
    salvarFeitos();
    aplicarTudo();
    const novos = feitos.size - antes;
    aviso(novos ? `Progresso importado: ${novos} marcaç${novos > 1 ? 'ões novas' : 'ão nova'}.` : 'Esse progresso já estava todo marcado aqui.');
    return true;
  }
  async function enviarLink() {
    const url = linkDoProgresso();
    try {
      if (navigator.share) { await navigator.share({ title: 'Meu progresso no mapa', url }); return; }
      await navigator.clipboard.writeText(url);
      aviso('Link copiado. Abra ele no outro aparelho.');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      prompt('Copie este link e abra no outro aparelho:', url);
    }
  }
  function colarLink() {
    const txt = prompt('Cole aqui o link do progresso:');
    if (txt === null) return;
    if (!importarDeTexto(txt)) aviso('Esse texto não é um link de progresso do mapa.');
  }

  function aplicarTudo() {
    D.locais.forEach((l) => l._m.setStyle(estilo(l)));
    desenharPontos();
    pintarFiltros();
    atualizarProgresso();
    if (atual) pintarBotaoFeito();
  }

  let tAviso;
  function aviso(msg) {
    const a = $('#aviso');
    a.textContent = msg;
    a.hidden = false;
    clearTimeout(tAviso);
    tAviso = setTimeout(() => { a.hidden = true; }, 3200);
  }

  function abrirDoHash() {
    const id = +location.hash.slice(1);
    if (id && porId.has(id)) abrir(id);
  }

  // ---------- eventos ----------
  function ligarEventos() {
    $('#cartao-fotos').addEventListener('click', (e) => { const b = e.target.closest('[data-foto]'); if (b) abrirVisor(+b.dataset.foto); });
    $('#visor-fechar').addEventListener('click', fecharVisor);
    $('#visor-fotos').addEventListener('click', (e) => { if (e.target === e.currentTarget) fecharVisor(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#visor').hidden) { e.stopImmediatePropagation(); fecharVisor(); } }, true);
    $('#btn-feito').addEventListener('click', () => { if (atual) { alternarFeito(atual); pintarBotaoFeito(); } });
    $('#btn-so').addEventListener('click', () => {
      if (!atual) return;
      if (so && so.c === atual.c) sairDoSo(); else soCategoria(atual.c);
    });
    $('#so-sair').addEventListener('click', sairDoSo);
    $('#lista-progresso').addEventListener('click', (e) => {
      const s = e.target.closest('[data-so]');
      if (s) { soCategoria(+s.dataset.so); return; }
      const b = e.target.closest('[data-bairro]');
      if (b) irParaBairro(+b.dataset.bairro);
    });
    document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
      vista = b.dataset.vista;
      gravar(CHAVE_VISTA, vista);
      atualizarProgresso();
    }));
    $('#fechar-cartao').addEventListener('click', fecharCartao);
    $('#cartao-desc').addEventListener('click', (e) => {
      const s = e.target.closest('.spoiler');
      if (s) { s.classList.add('visto'); s.removeAttribute('aria-label'); return; }
      const a = e.target.closest('[data-ir]');
      if (a) { e.preventDefault(); abrir(+a.dataset.ir); }
    });
    mapa.on('click', () => { if (atual) fecharCartao(); $('#resultados').hidden = true; });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#resultados').hidden) { $('#resultados').hidden = true; return; }
      if (atual) fecharCartao(); else fecharGaveta();
    });

    const busca = $('#busca');
    let tBusca;
    busca.addEventListener('input', () => { clearTimeout(tBusca); tBusca = setTimeout(() => buscar(busca.value), 120); });
    busca.addEventListener('focus', () => { if (busca.value) buscar(busca.value); fecharGaveta(); });
    $('#limpar-busca').addEventListener('click', () => { busca.value = ''; buscar(''); busca.focus(); });
    $('#resultados').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ir]');
      if (!b) return;
      $('#resultados').hidden = true;
      busca.blur();
      abrir(+b.dataset.ir);
    });

    $('#btn-dia').addEventListener('click', () => trocarModo(modo === 'Day' ? 'Night' : 'Day'));

    $('#alca').addEventListener('click', () => {
      const g = $('#gaveta'), abre = !g.classList.contains('aberta');
      g.classList.toggle('aberta', abre);
      $('#alca').setAttribute('aria-expanded', String(abre));
      if (abre && atual) fecharCartao();
    });
    document.querySelectorAll('.aba').forEach((a) => a.addEventListener('click', () => {
      trocarAba(a.dataset.aba);
      $('#gaveta').classList.add('aberta');
      $('#alca').setAttribute('aria-expanded', 'true');
    }));
    $('#progresso-mini').addEventListener('click', () => {
      trocarAba('progresso');
      $('#gaveta').classList.add('aberta');
      if (atual) fecharCartao();
    });

    $('#lista-grupos').addEventListener('click', (e) => {
      const sc = e.target.closest('.secao-cab');
      if (sc) {
        const id = +sc.parentElement.dataset.s, abre = fechadas.has(id);
        abre ? fechadas.delete(id) : fechadas.add(id);
        sc.setAttribute('aria-expanded', String(abre));
        sc.nextElementSibling.hidden = !abre;
        gravar(CHAVE_FECHADAS, [...fechadas]);
        return;
      }
      const c = e.target.closest('.cat');
      if (c) { largarSo(); const id = +c.dataset.c; ocultas.has(id) ? ocultas.delete(id) : ocultas.add(id); mudouFiltro(); return; }
      const g = e.target.closest('.grupo-alt');
      if (g) {
        const cats = D.categorias.filter((x) => x.g === +g.dataset.g);
        const todas = cats.every((x) => !ocultas.has(x.id));
        largarSo();
        cats.forEach((x) => (todas ? ocultas.add(x.id) : ocultas.delete(x.id)));
        mudouFiltro();
      }
    });
    $('#mostrar-tudo').addEventListener('click', () => { largarSo(); ocultas.clear(); mudouFiltro(); });
    $('#esconder-tudo').addEventListener('click', () => { largarSo(); D.categorias.forEach((c) => ocultas.add(c.id)); mudouFiltro(); });
    $('#esconder-feitos').addEventListener('change', (e) => {
      esconderFeitos = e.target.checked;
      gravar(CHAVE_ESC_FEITOS, esconderFeitos);
      desenharPontos();
    });

    $('#btn-nuvem').addEventListener('click', botaoNuvem);
    $('#baixar-backup').addEventListener('click', baixarBackup);
    $('#enviar-link').addEventListener('click', enviarLink);
    $('#colar-link').addEventListener('click', colarLink);
    $('#arquivo-backup').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) restaurarBackup(f);
      e.target.value = '';
    });
    $('#zerar').addEventListener('click', () => {
      if (!feitos.size) { aviso('Ainda não tem nada marcado.'); return; }
      if (!confirm(`Apagar as ${feitos.size} marcações deste aparelho? Não dá para desfazer sem um backup.`)) return;
      feitos.clear();
      salvarFeitos();
      aplicarTudo();
      aviso('Progresso apagado.');
    });

    window.addEventListener('hashchange', abrirDoHash);
  }

  iniciar().catch((e) => {
    console.error(e);
    document.body.insertAdjacentHTML('beforeend', '<div class="aviso">Não deu para carregar os dados do mapa. Confira a internet e abra de novo.</div>');
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
