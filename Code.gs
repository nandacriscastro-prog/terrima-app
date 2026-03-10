// ═══════════════════════════════════════════════════════════════
// TERRIMA — SISTEMA DE GESTÃO DE CARTEIRA CEMIG
// Code.gs — Backend Google Apps Script (modo API REST)
//
// Deploy como: Web App → Execute as "Me" → Anyone can access
// Todas as chamadas chegam via doGet (leitura) e doPost (escrita)
// ═══════════════════════════════════════════════════════════════

var SS_ID = '1vWmZL7agD-0lvce329iI6MgqUwx8qRmCY_LhIFA9WD0';

var ABA_CONFIG = {
  'PROGRAMAÇÃO CARTEIRA': { colunas: 19 },
  'PROGRAMAÇÃO DIÁRIA':   { colunas: 19 },
  'MANOBRAS':             { colunas: 18 },
  'ESCALA SOBREAVISO':    { colunas: 10 },
  'LT BCST-TQL C1 (2)':  { colunas: 20 }
};

var COLUNAS_SYNC_MANOBRA = [0, 4, 7];

// ── CORS helper ─────────────────────────────────────────────────
function _cors(output) {
  return output
    .setMimeType(ContentService.MimeType.JSON)
    .addHeader('Access-Control-Allow-Origin', '*')
    .addHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    .addHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function _json(obj) {
  return _cors(ContentService.createTextOutput(JSON.stringify(obj)));
}

function _err(msg) {
  return _json({ ok: false, error: msg });
}

// ── ENTRY POINTS ────────────────────────────────────────────────

function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action;
    if (!action) return _err('action required');

    if (action === 'lerDadosAbaComMapa') {
      var aba = e.parameter.aba;
      return _json({ ok: true, data: lerDadosAbaComMapa(aba) });
    }

    if (action === 'ping') {
      return _json({ ok: true, ts: new Date().toISOString() });
    }

    return _err('GET action desconhecida: ' + action);
  } catch(err) {
    return _err(err.message);
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    if (action === 'salvarAlteracao') {
      salvarAlteracao(body.aba, body.linha, body.coluna, body.valor);
      return _json({ ok: true });
    }

    if (action === 'inserirLinhaDiaria') {
      inserirLinhaDiaria();
      return _json({ ok: true });
    }

    if (action === 'inserirLinhaManobra') {
      inserirLinhaManobra();
      return _json({ ok: true });
    }

    if (action === 'inserirLinhaSobreaviso') {
      inserirLinhaSobreaviso();
      return _json({ ok: true });
    }

    if (action === 'excluirLinhaDiaria') {
      excluirLinhaDiaria(body.idx);
      return _json({ ok: true });
    }

    if (action === 'calcularAreaExecLote') {
      var r = calcularAreaExecLote();
      return _json({ ok: true, data: r });
    }

    if (action === 'recalcularUSLote') {
      var r = recalcularUSLote();
      return _json({ ok: true, data: r });
    }

    if (action === 'diagnosticoLT') {
      var r = diagnosticoLT();
      return _json({ ok: true, data: r });
    }

    return _err('POST action desconhecida: ' + action);
  } catch(err) {
    return _err(err.message);
  }
}

// ───────────────────────────────────────────────────────────────
// LEITURA DE DADOS
// ───────────────────────────────────────────────────────────────
function lerDadosAba(nomeAba) {
  try {
    _validarNomeAba(nomeAba);

    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName(nomeAba);
    if (!sheet) throw new Error("Aba '" + nomeAba + "' não encontrada.");

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { linhas: [], opcoes: getOpcoes() };

    var numCols  = ABA_CONFIG[nomeAba].colunas;
    var dados    = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    var display  = sheet.getRange(2, 1, lastRow - 1, numCols).getDisplayValues();
    var isManob  = nomeAba === 'MANOBRAS';

    var toNum = function(raw, disp) {
      if (typeof raw === 'number') return raw;
      var str = String(disp !== undefined ? disp : raw).trim();
      if (!str || str === '-') return 0;
      str = str.replace(/\./g, '').replace(',', '.');
      return parseFloat(str) || 0;
    };
    var toStr  = function(v) { return v !== null && v !== undefined ? String(v).trim() : ''; };
    var toDate = function(v) {
      if (v instanceof Date) return Utilities.formatDate(v, 'GMT-3', 'dd/MM/yyyy');
      return toStr(v);
    };

    var linhas = dados.map(function(row, i) {
      var l = row.map(function(cell, j) {
        var raw  = cell;
        var disp = display[i][j];
        if (raw instanceof Date) return toDate(raw);
        if (typeof raw === 'boolean') return raw ? 'SIM' : 'NÃO';
        if (typeof raw === 'number') return toNum(raw, disp);
        return toStr(raw);
      });
      return l;
    });

    return { linhas: linhas, opcoes: getOpcoes(), mapaNSCarteira: isManob ? getMapaNSCarteira() : {} };
  } catch(err) {
    throw new Error('lerDadosAba: ' + err.message);
  }
}

function salvarAlteracao(nomeAba, linha, coluna, valor) {
  if (nomeAba === 'LT BCST-TQL C1 (2)') {
    return salvarAlteracaoLT(linha, coluna, valor);
  }
  try {
    _validarNomeAba(nomeAba);
    _validarIndices(linha, coluna);

    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName(nomeAba);
    if (!sheet) throw new Error("Aba não encontrada: " + nomeAba);

    var rowIdx = parseInt(linha, 10)  + 2;
    var colIdx = parseInt(coluna, 10) + 1;

    sheet.getRange(rowIdx, colIdx).setValue(valor);

    if (nomeAba === 'MANOBRAS' && COLUNAS_SYNC_MANOBRA.indexOf(colIdx - 1) !== -1) {
      _sincronizarManobraComCarteira(ss, rowIdx);
    }
  } catch (err) {
    throw new Error('salvarAlteracao: ' + err.message);
  }
}

function _sincronizarManobraComCarteira(ss, rowIdxManobra) {
  try {
    var sheetManobras  = ss.getSheetByName('MANOBRAS');
    var sheetCarteira  = ss.getSheetByName('PROGRAMAÇÃO CARTEIRA');
    if (!sheetManobras || !sheetCarteira) return;

    var dadosManobra = sheetManobras.getRange(rowIdxManobra, 1, 1, 9).getValues()[0];
    var dataManobra  = dadosManobra[0];
    var nsManobra    = String(dadosManobra[4] || '').trim();
    var nSolicManob  = String(dadosManobra[7] || '').trim();
    if (!nsManobra) return;

    var lastRowCart = sheetCarteira.getLastRow();
    if (lastRowCart < 2) return;
    var colNS = sheetCarteira.getRange(2, 2, lastRowCart - 1, 1).getValues();

    colNS.forEach(function(row, i) {
      if (String(row[0]).trim() === nsManobra) {
        var rowCart = i + 2;
        if (dataManobra instanceof Date) {
          sheetCarteira.getRange(rowCart, 1).setValue(dataManobra);
        }
        if (nSolicManob) {
          sheetCarteira.getRange(rowCart, 8).setValue(nSolicManob);
        }
      }
    });
  } catch(e) {
    // silencioso — sync é best-effort
  }
}

function inserirLinhaDiaria()     { _inserirLinha('PROGRAMAÇÃO DIÁRIA'); }
function inserirLinhaManobra()    { _inserirLinha('MANOBRAS'); }
function inserirLinhaSobreaviso() { _inserirLinha('ESCALA SOBREAVISO'); }

function _inserirLinha(nomeAba) {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName(nomeAba);
    if (!sheet) throw new Error("Aba '" + nomeAba + "' não encontrada.");
    sheet.appendRow([Utilities.formatDate(new Date(), 'GMT-3', 'dd/MM/yyyy')]);
  } catch(err) {
    throw new Error('_inserirLinha: ' + err.message);
  }
}

function excluirLinhaDiaria(idx) {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('PROGRAMAÇÃO DIÁRIA');
    if (!sheet) throw new Error('Aba PROGRAMAÇÃO DIÁRIA não encontrada.');
    var rowIdx = parseInt(idx, 10) + 2;
    if (rowIdx < 2 || rowIdx > sheet.getLastRow()) throw new Error('Índice de linha inválido: ' + rowIdx);
    sheet.deleteRow(rowIdx);
  } catch(err) {
    throw new Error('excluirLinhaDiaria: ' + err.message);
  }
}

function getOpcoes() {
  return {
    statusServico:         ['EXECUTADO','NÃO EXECUTADO','EXECUTADO PARCIAL','PENDENTE DOC','AGUARDANDO ASSINATURA','EM ANDAMENTO'],
    statusServicoCarteira: ['EXECUTADO','NÃO EXECUTADO','EXECUTADO PARCIAL','PENDENTE DOC','AGUARDANDO ASSINATURA','EM ANDAMENTO'],
    statusManobra:         ['CONCLUÍDA','PENDENTE','EM ANDAMENTO','CANCELADA'],
    tiposServico:          ['PODA','LIMPEZA','INSPEÇÃO','MANUTENÇÃO','INSTALAÇÃO','REPARO','EMERGÊNCIA','OUTROS']
  };
}

function _validarNomeAba(nome) {
  if (!nome || !ABA_CONFIG[nome]) {
    throw new Error("Nome de aba inválido: '" + nome + "'");
  }
}

function _validarIndices(linha, coluna) {
  var l = parseInt(linha, 10);
  var c = parseInt(coluna, 10);
  if (isNaN(l) || l < 0) throw new Error('Índice de linha inválido: ' + linha);
  if (isNaN(c) || c < 0) throw new Error('Índice de coluna inválido: ' + coluna);
}

function getMapaNSCarteira() {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('PROGRAMAÇÃO CARTEIRA');
    if (!sheet) return {};
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return {};
    var dados = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    var mapa  = {};
    dados.forEach(function(row) {
      var ns = String(row[1] || '').trim();
      var us = parseFloat(String(row[5] || '').replace(',', '.')) || 0;
      if (ns) mapa[ns] = (mapa[ns] || 0) + us;
    });
    return mapa;
  } catch(e) {
    return {};
  }
}

function lerDadosAbaComMapa(nomeAba) {
  if (nomeAba === 'LT BCST-TQL C1 (2)') {
    return lerDadosLT();
  }
  var resultado = lerDadosAba(nomeAba);
  if (nomeAba === 'MANOBRAS') {
    resultado.mapaNSCarteira = getMapaNSCarteira();
  }
  return resultado;
}

// ───────────────────────────────────────────────────────────────
// NOVA ESTRUTURA DE COLUNAS LT (linha 10 em diante)
//  A=Estrutura  B=Posição   C=CompPrev  D=LargPrev
//  E=CompExec   F=LargExec  G=ÁreaPrev  H=ÁreaExec
//  I=TipoServ   J=US        K=DataMarcação  L=LT
//  M=Executor   N=Circuito  O=Local     P=Criticidade
//  Q=?          R=FatorMult S+T+U=Obs   W=Município
// ───────────────────────────────────────────────────────────────
function lerDadosLT() {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('LT BCST-TQL C1 (2)');
    if (!sheet) throw new Error("Aba 'LT BCST-TQL C1 (2)' nao encontrada.");

    var lastRow   = sheet.getLastRow();
    if (lastRow < 10) return { linhas: [], opcoes: getOpcoes() };
    var numLinhas = lastRow - 9;
    var lastCol   = sheet.getLastColumn();
    var numCols   = Math.min(Math.max(lastCol, 23), 30);

    var dados   = sheet.getRange(10, 1, numLinhas, numCols).getValues();
    var display = sheet.getRange(10, 1, numLinhas, numCols).getDisplayValues();

    var col  = function(row, idx) { return (row && row.length > idx) ? row[idx] : ''; };
    var colD = function(disp, idx) { return (disp && disp.length > idx) ? disp[idx] : ''; };

    var toNum = function(raw, disp) {
      if (typeof raw === 'number') return raw;
      var str = String(disp !== undefined ? disp : raw).trim();
      if (!str || str === '-' || str.toUpperCase() === 'NA') return 0;
      str = str.replace(/\./g, '').replace(',', '.');
      return parseFloat(str) || 0;
    };
    var toStr  = function(v) { return v !== null && v !== undefined ? String(v).trim() : ''; };
    var toBool = function(v) {
      if (v === true)  return 'SIM';
      if (v === false) return 'NAO';
      var s = String(v || '').toUpperCase().trim();
      return (s==='SIM'||s==='S'||s==='TRUE'||s==='1') ? 'SIM' :
             (s==='NAO'||s==='N'||s==='FALSE'||s==='0'||s==='NÃO') ? 'NAO' : '';
    };
    var toDate = function(v) {
      if (v instanceof Date) return Utilities.formatDate(v, 'GMT-3', 'dd/MM/yyyy');
      return toStr(v);
    };

    var rawLinhas = [];
    dados.forEach(function(row, i) {
      var est = row[0];
      if (!est) return;
      if (String(est).indexOf('MARCA')       !== -1) return;
      if (String(est).indexOf('Comprimento') !== -1) return;
      if (String(est).indexOf('Estrutura')   !== -1) return;

      var compPrev  = toNum(col(row,2),  colD(display[i],2));
      var largPrev  = toNum(col(row,3),  colD(display[i],3));
      var compExec  = toNum(col(row,4),  colD(display[i],4));
      var largExec  = toNum(col(row,5),  colD(display[i],5));
      var areaPrev  = toNum(col(row,6),  colD(display[i],6));
      var areaExec  = toNum(col(row,7),  colD(display[i],7));
      var saldoComp = compPrev - compExec;
      var saldoArea = areaPrev - areaExec;
      var excedente = compExec > compPrev && compPrev > 0;

      var obs = [toStr(col(row,18)), toStr(col(row,19)), toStr(col(row,20))]
                  .filter(function(s){ return s !== ''; }).join(' | ');

      var chave = toStr(est)+'|'+toStr(col(row,1))+'|'+toStr(col(row,2))+'|'+toStr(col(row,3))+'|'+toStr(col(row,8))+'|'+toStr(col(row,13))+'|'+toStr(col(row,14));

      rawLinhas.push({
        rowIdx:  i,
        chave:   chave,
        temExec: toDate(col(row,10)) !== '',
        linha: [
          toStr(est),                              //  0  A   Estrutura/Vão
          toStr(col(row,1)),                       //  1  B   Posição
          compPrev,                                //  2  C   Comp. Previsto
          largPrev,                                //  3  D   Larg. Prevista
          compExec,                                //  4  E   Comp. Executado
          largExec,                                //  5  F   Larg. Executada
          areaPrev,                                //  6  G   Área Prevista m²
          areaExec,                                //  7  H   Área Executada m²
          saldoComp,                               //  8  calc Saldo Comp
          saldoArea,                               //  9  calc Saldo Área
          excedente,                               // 10  calc flag excedente
          toStr(col(row,8)),                       // 11  I   Tipo Serviço
          toNum(col(row,9), colD(display[i],9)),   // 12  J   US Equiv.
          toStr(col(row,15)),                      // 13  P   Criticidade
          '',                                      // 14      Trator (não existe)
          '',                                      // 15      MIV (não existe)
          toDate(col(row,10)),                     // 16  K   Data Marcação
          toStr(col(row,11)),                      // 17  L   LT
          toStr(col(row,12)),                      // 18  M   Executor
          toStr(col(row,13)),                      // 19  N   Circuito
          toStr(col(row,14)),                      // 20  O   Local
          toNum(col(row,17), colD(display[i],17)), // 21  R   Fator Multiplicação
          obs,                                     // 22  S+T+U Obs
          toStr(col(row,22))                       // 23  W   Município
        ]
      });
    });

    var mapaChave  = {};
    var duplicatas = [];
    rawLinhas.forEach(function(r) {
      var k = r.chave;
      if (!mapaChave[k]) {
        mapaChave[k] = r;
      } else {
        var existente = mapaChave[k];
        if (r.temExec && !existente.temExec) {
          existente.isDuplicata = true;
          existente.dupPrincipalIdx = r.rowIdx;
          duplicatas.push(existente);
          mapaChave[k] = r;
          r.temDupSemExec = true;
        } else if (!r.temExec && existente.temExec) {
          r.isDuplicata = true;
          r.dupPrincipalIdx = existente.rowIdx;
          duplicatas.push(r);
          existente.temDupSemExec = true;
        } else {
          r.isDuplicata = true;
          r.dupPrincipalIdx = existente.rowIdx;
          duplicatas.push(r);
          existente.temDupSemExec = true;
        }
      }
    });

    var linhas = [];
    Object.values(mapaChave).forEach(function(r) {
      var l = r.linha.slice();
      l._rowIdx        = r.rowIdx;
      l._isDuplicata   = false;
      l._temDupSemExec = r.temDupSemExec || false;
      linhas.push(l);
    });
    duplicatas.forEach(function(r) {
      var l = r.linha.slice();
      l._rowIdx      = r.rowIdx;
      l._isDuplicata = true;
      l._dupDeIdx    = r.dupPrincipalIdx;
      linhas.push(l);
    });

    return { linhas: linhas, opcoes: getOpcoes() };

  } catch (err) {
    throw new Error('lerDadosLT: ' + err.message);
  }
}

// ───────────────────────────────────────────────────────────────
// SALVAR NA ABA LT (com mapa JS array idx → coluna planilha)
// ───────────────────────────────────────────────────────────────
function salvarAlteracaoLT(linha, coluna, valor) {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('LT BCST-TQL C1 (2)');
    if (!sheet) throw new Error("Aba LT não encontrada.");
    var rowIdx = parseInt(linha, 10) + 10;

    var JS_TO_SHEET = {
      0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8,
      11: 9,   // I  Tipo Serviço
      12: 10,  // J  US Equiv.
      13: 16,  // P  Criticidade
      16: 11,  // K  Data Marcação
      17: 12,  // L  LT
      18: 13,  // M  Executor
      19: 14,  // N  Circuito
      20: 15,  // O  Local
      21: 18,  // R  Fator Multiplicação
      22: 19,  // S  Obs
      23: 23   // W  Município
    };

    var jsIdx  = parseInt(coluna, 10);
    var colIdx = JS_TO_SHEET[jsIdx];
    if (!colIdx) throw new Error('Coluna JS ' + jsIdx + ' não mapeada.');
    sheet.getRange(rowIdx, colIdx).setValue(valor);
  } catch (err) {
    throw new Error('salvarAlteracaoLT: ' + err.message);
  }
}

// ───────────────────────────────────────────────────────────────
// CALCULAR ÁREA EXEC EM LOTE
// ───────────────────────────────────────────────────────────────
function calcularAreaExecLote() {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('LT BCST-TQL C1 (2)');
    if (!sheet) throw new Error("Aba LT não encontrada.");
    var lastRow   = sheet.getLastRow();
    if (lastRow < 10) return { atualizadas: 0, ignoradas: 0 };
    var numLinhas = lastRow - 9;
    var dados     = sheet.getRange(10, 1, numLinhas, 8).getValues();

    var atualizadas = 0, ignoradas = 0, updates = [];
    var toNum = function(v) {
      if (typeof v === 'number') return v;
      var s = String(v || '').trim().replace(/\./g,'').replace(',','.');
      return parseFloat(s) || 0;
    };

    dados.forEach(function(row, i) {
      var est = row[0];
      if (!est || String(est).match(/Estrutura|Comprimento|MARCA/i)) { ignoradas++; return; }
      var compExec = toNum(row[4]);
      var largExec = toNum(row[5]);
      if (compExec > 0 && largExec > 0) {
        updates.push({ rowReal: i + 10, val: Math.round(compExec * largExec * 100) / 100 });
        atualizadas++;
      } else {
        ignoradas++;
      }
    });

    updates.forEach(function(u) { sheet.getRange(u.rowReal, 8).setValue(u.val); });
    return { atualizadas: atualizadas, ignoradas: ignoradas };
  } catch (err) {
    throw new Error('calcularAreaExecLote: ' + err.message);
  }
}

// ───────────────────────────────────────────────────────────────
// TABELA US — fórmula da planilha base: US = Área × mult
// ───────────────────────────────────────────────────────────────
var LT_US_MULT_GS = {
  'F1':1,'F2':1.5,'PES':1,'RF':2,'AT':2,'P.S':2,'PB':3,'CCS':2,
  'MEC1':1,'MEC2':0.6,'NA':0,'PU':1500,'AU':3000,'AI':500,
  'MB':20,'CV':40,'PT':360,'CT':300,'CSC':150,'CAT':150,'CM':140,'ERPT':2000
};

function ltCalcUSGS(tipo, areaPrev) {
  var t = String(tipo || '').toUpperCase().trim();
  if (!(t in LT_US_MULT_GS)) return null;
  return (parseFloat(areaPrev) || 0) * LT_US_MULT_GS[t];
}

// ───────────────────────────────────────────────────────────────
// RECALCULAR US EM LOTE
// ───────────────────────────────────────────────────────────────
function recalcularUSLote() {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('LT BCST-TQL C1 (2)');
    if (!sheet) throw new Error('Aba LT não encontrada.');
    var lastRow = sheet.getLastRow();
    if (lastRow < 10) return { atualizadas: 0, ignoradas: 0 };
    var dados = sheet.getRange(10, 1, lastRow - 9, 10).getValues();

    var atualizadas = 0, ignoradas = 0, updates = [];
    var toNum = function(v) {
      if (typeof v === 'number') return v;
      var s = String(v||'').trim().replace(/\./g,'').replace(',','.');
      return parseFloat(s)||0;
    };

    dados.forEach(function(row, i) {
      var est = row[0];
      if (!est || String(est).match(/Estrutura|Comprimento/i)) { ignoradas++; return; }
      var areaPrev = toNum(row[6]);
      var tipo     = String(row[8] || '').trim();
      if (!tipo) { ignoradas++; return; }
      var us = ltCalcUSGS(tipo, areaPrev);
      if (us === null) { ignoradas++; return; }
      updates.push({ rowReal: i + 10, us: us });
      atualizadas++;
    });

    updates.forEach(function(u) { sheet.getRange(u.rowReal, 10).setValue(u.us); });
    return { atualizadas: atualizadas, ignoradas: ignoradas };
  } catch (err) {
    throw new Error('recalcularUSLote: ' + err.message);
  }
}

// ───────────────────────────────────────────────────────────────
// DIAGNÓSTICO LT
// ───────────────────────────────────────────────────────────────
function diagnosticoLT() {
  try {
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('LT BCST-TQL C1 (2)');
    if (!sheet) return { erro: 'Aba não encontrada' };

    var lastRow  = sheet.getLastRow();
    var lastCol  = sheet.getLastColumn();
    var sample   = [];
    var numSample = Math.min(5, lastRow - 9);
    if (numSample > 0) {
      var amostra = sheet.getRange(10, 1, numSample, Math.min(lastCol, 23)).getValues();
      amostra.forEach(function(row, i) {
        sample.push({
          linha: i + 10,
          colA: String(row[0] || ''),
          colB: String(row[1] || ''),
          colG: String(row[6] || ''),
          colI: String(row[8] || ''),
          colJ: String(row[9] || ''),
          colK: String(row[10] || ''),
          colM: String(row[12] || ''),
          totalCols: row.length
        });
      });
    }
    return { lastRow: lastRow, lastCol: lastCol, numLinhasDados: lastRow - 9, amostra: sample };
  } catch(e) {
    return { erro: e.message };
  }
}
