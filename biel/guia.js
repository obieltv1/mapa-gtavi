// Guia de Leonida: tela cheia com uma aba por tema (dados em guia.json).
(() => {
  const $ = (s) => document.querySelector(s);
  const CHAVE = 'gta6:' + location.pathname.replace(/[^/]*$/, '') + ':guia-aba';
  const ler = () => { try { return localStorage.getItem(CHAVE); } catch { return null; } };
  const gravar = (v) => { try { localStorage.setItem(CHAVE, v); } catch { /* sem armazenamento */ } };

  const TECLAS = { CIMA: 'direcional ↑', BAIXO: 'direcional ↓', DIREITA: 'direcional →', ESQUERDA: 'direcional ←' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([A-Z]{1,8})\]/g, (_, k) => `<kbd class="tecla">${TECLAS[k] || k}</kbd>`);
  const num = (v) => String(v).replace('.', ',');
  const corVar = (c) => (c ? ` style="--c:${esc(c)}"` : '');

  let dados = null, carregando = null, atual = null, voltarFoco = null;

  function carregar() {
    if (dados) return Promise.resolve(dados);
    if (!carregando) {
      carregando = fetch('guia.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((d) => (dados = d))
        .catch((e) => { carregando = null; throw e; });
    }
    return carregando;
  }

  // ---------- blocos ----------
  const BARRAS = ['Dano', 'Precisão', 'Manejo', 'Alcance'];
  const nota = (n) => (n ? `<p class="g-nota">${fmt(n)}</p>` : '');

  const R = {
    escala: (b) => `<ol class="g-escala">${b.itens.map((i) => `
      <li class="g-degrau${i.vazado ? ' vazado' : ''}"${corVar(i.cor)}>
        <span class="g-no" aria-hidden="true"></span>
        <div>
          <h3>${fmt(i.nome)}</h3>
          ${i.orig ? `<p class="g-orig">${fmt(i.orig)}</p>` : ''}
          <p>${fmt(i.texto)}</p>
          ${nota(i.nota)}
        </div>
      </li>`).join('')}</ol>`,

    linhas: (b) => `<div class="g-linhas">${b.itens.map((i) => `
      <section class="g-linha"${corVar(i.cor)}>
        <h3>${fmt(i.nome)}</h3>
        ${i.sub ? `<p class="g-sub">${fmt(i.sub)}</p>` : ''}
        ${i.barras ? barras(i.barras) : ''}
        <p>${fmt(i.texto)}</p>
        ${nota(i.nota)}
      </section>`).join('')}</div>`,

    titulo: (b) => `<h3 class="g-secao">${fmt(b.txt)}</h3>${b.sub ? `<p class="g-secao-sub">${fmt(b.sub)}</p>` : ''}`,

    'nota-barras': (b) => `<p class="g-legenda">${fmt(b.txt)}</p>`,

    dicas: (b) => `<aside class="g-dicas" aria-label="Dicas"><h3>Dicas</h3><ul>${b.itens.map((i) => `
      <li><strong>${fmt(i.t)}.</strong> ${fmt(i.txt)}</li>`).join('')}</ul></aside>`,

    duas: (b) => `<div class="g-duas">${b.itens.map((i) => `
      <section class="g-caixa"${corVar(i.cor)}><h3>${fmt(i.t)}</h3><p>${fmt(i.txt)}</p></section>`).join('')}</div>`,

    degraus: (b) => `<h3 class="g-secao">${fmt(b.titulo)}</h3><ol class="g-escada">${b.itens.map((i, n) => `
      <li style="--n:${n}"><span class="g-valor">${fmt(i.valor)}</span><span>${fmt(i.txt)}</span></li>`).join('')}</ol>${nota(b.nota)}`,

    ranking: (b) => `<ol class="g-ranking">${b.itens.map((i) => `
      <li>
        <div class="g-rank-cab"><h3>${fmt(i.nome)}</h3><span class="g-rank-num">${num(i.valor)}</span></div>
        <div class="g-trilho" aria-hidden="true"><span style="width:${i.valor * 10}%"></span></div>
        <p class="g-sub">${fmt(i.sub)}</p>
        ${nota(i.nota)}
      </li>`).join('')}</ol>`,

    tabela: (b) => `<dl class="g-tabela">${b.itens.map(([k, v]) => `<div><dt>${fmt(k)}</dt><dd>${fmt(v)}</dd></div>`).join('')}</dl>`,

    passos: (b) => `<ol class="g-passos">${b.itens.map((i) => `
      <li>
        <h3>${fmt(i.nome)}</h3>
        <p>${fmt(i.texto)}</p>
        ${i.extra ? `<div class="g-extra"><h4>${fmt(i.extra.nome)}</h4><p class="g-sub">${fmt(i.extra.sub)}</p><p>${fmt(i.extra.texto)}</p></div>` : ''}
      </li>`).join('')}</ol>`,
  };

  function barras(vals) {
    return `<dl class="g-barras">${vals.map((v, n) => `
      <div><dt>${BARRAS[n]}</dt><dd><span class="g-trilho"><span style="width:${v * 10}%"></span></span><b>${num(v)}</b></dd></div>`).join('')}</dl>`;
  }

  // ---------- tela ----------
  function montarAbas() {
    $('#guia-abas').innerHTML = dados.topicos.map((t) => `
      <button role="tab" class="g-aba" id="g-aba-${t.id}" data-t="${t.id}" aria-controls="guia-corpo" aria-selected="false" tabindex="-1">${esc(t.aba)}</button>`).join('');
  }

  function mostrar(id, focar) {
    const t = dados.topicos.find((x) => x.id === id) || dados.topicos[0];
    atual = t.id;
    gravar(t.id);
    document.querySelectorAll('.g-aba').forEach((b) => {
      const sim = b.dataset.t === t.id;
      b.setAttribute('aria-selected', String(sim));
      b.tabIndex = sim ? 0 : -1;
      if (sim) {
        b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        if (focar) b.focus();
      }
    });
    const corpo = $('#guia-corpo');
    corpo.setAttribute('aria-labelledby', 'g-aba-' + t.id);
    corpo.innerHTML = `
      <h2 class="g-titulo">${fmt(t.titulo)}</h2>
      <p class="g-resumo">${fmt(t.resumo)}</p>
      ${t.blocos.map((b) => (R[b.tipo] ? R[b.tipo](b) : '')).join('')}
      <p class="g-credito">${fmt(dados.credito)} Botões do controle de Xbox.</p>`;
    corpo.scrollTop = 0;
  }

  async function abrir() {
    const g = $('#guia');
    voltarFoco = document.activeElement;
    g.hidden = false;
    document.body.classList.add('guia-aberto');
    try {
      await carregar();
      if (!$('#guia-abas').children.length) montarAbas();
      mostrar(atual || ler(), true);
    } catch (e) {
      console.error(e);
      $('#guia-corpo').innerHTML = '<p class="g-resumo">Não deu para carregar o guia. Confira a internet e tente de novo.</p>';
      $('#guia-fechar').focus();
    }
  }

  function fechar() {
    $('#guia').hidden = true;
    document.body.classList.remove('guia-aberto');
    if (voltarFoco && voltarFoco.focus) voltarFoco.focus();
  }

  function ligar() {
    $('#btn-guia').addEventListener('click', abrir);
    $('#guia-fechar').addEventListener('click', fechar);
    $('#guia-abas').addEventListener('click', (e) => {
      const b = e.target.closest('.g-aba');
      if (b) mostrar(b.dataset.t);
    });
    $('#guia-abas').addEventListener('keydown', (e) => {
      if (!dados || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const ids = dados.topicos.map((t) => t.id);
      let i = ids.indexOf(atual);
      if (e.key === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
      else if (e.key === 'ArrowRight') i = (i + 1) % ids.length;
      else i = e.key === 'Home' ? 0 : ids.length - 1;
      mostrar(ids[i], true);
    });
    // Escape fecha o guia antes de qualquer outra coisa do mapa
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#guia').hidden) { e.stopImmediatePropagation(); fechar(); }
    }, true);
    if (location.hash === '#guia') abrir();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar);
  else ligar();
})();
