var keywords = new Set((
  "break case chan const continue default defer else fallthrough for func go"
  + " goto if import interface map package range return select struct switch"
  + " type var bool byte complex64 complex128 float32 float64 int8 int16"
  + " int32 int64 string uint8 uint16 uint32 uint64 int uint uintptr error"
  + " rune"
).split` `);

var atoms = new Set((
  "true false iota nil append cap close complex copy delete imag len make new"
  + " panic print println real recover"
).split` `);

var isOperatorChar = /[+\-*&^%:=<>!|\/]/;

var curPunc;

function tokenBase(stream, state) {
  var ch = stream.next();
  if (ch == '"' || ch == "'" || ch == "`") {
    state.tokenize = tokenString(ch);
    return state.tokenize(stream, state);
  }
  if (/[\d\.]/.test(ch)) {
    if (ch == ".") {
      stream.match(/^[0-9]+([eE][\-+]?[0-9]+)?/);
    } else if (ch == "0") {
      stream.match(/^[xX][0-9a-fA-F]+/) || stream.match(/^0[0-7]+/);
    } else {
      stream.match(/^[0-9]*\.?[0-9]*([eE][\-+]?[0-9]+)?/);
    }
    return "number";
  }
  if (/[\[\]{}\(\),;\:\.]/.test(ch)) {
    curPunc = ch;
    return null;
  }
  if (ch == "/") {
    if (stream.eat("*")) {
      state.tokenize = tokenComment;
      return tokenComment(stream, state);
    }
    if (stream.eat("/")) {
      stream.skipToEnd();
      return "comment";
    }
  }
  if (isOperatorChar.test(ch)) {
    stream.eatWhile(isOperatorChar);
    return "operator";
  }
  stream.eatWhile(/[\w\$_\xa1-\uffff]/);
  var cur = stream.current();
  if (keywords.has(cur)) {
    if (cur == "case" || cur == "default") curPunc = "case";
    return "keyword";
  }
  if (atoms.has(cur)) return "atom";
  return "variable";
}

function tokenString(quote) {
  return function(stream, state) {
    var escaped = false, next, end = false;
    while ((next = stream.next()) != null) {
      if (next == quote && !escaped) {end = true; break;}
      escaped = !escaped && quote != "`" && next == "\\";
    }
    if (end || !(escaped || quote == "`"))
      state.tokenize = tokenBase;
    return "string";
  };
}

function tokenComment(stream, state) {
  var maybeEnd = false, ch;
  while (ch = stream.next()) {
    if (ch == "/" && maybeEnd) {
      state.tokenize = tokenBase;
      break;
    }
    maybeEnd = (ch == "*");
  }
  return "comment";
}

function Context(indented, column, type, align, prev) {
  this.indented = indented;
  this.column = column;
  this.type = type;
  this.align = align;
  this.prev = prev;
}
function pushContext(state, col, type) {
  return state.context = new Context(state.indented, col, type, null, state.context);
}
function popContext(state) {
  if (!state.context.prev) return;
  var t = state.context.type;
  if (t == ")" || t == "]" || t == "}")
    state.indented = state.context.indented;
  return state.context = state.context.prev;
}

// Interface

export const go = {
  startState: function(indentUnit) {
    return {
      tokenize: null,
      context: new Context(-indentUnit, 0, "top", false),
      indented: 0,
      startOfLine: true
    };
  },

  token: function(stream, state) {
    var ctx = state.context;
    if (stream.sol()) {
      if (ctx.align == null) ctx.align = false;
      state.indented = stream.indentation();
      state.startOfLine = true;
      if (ctx.type == "case") ctx.type = "}";
    }
    if (stream.eatSpace()) return null;
    curPunc = null;
    var style = (state.tokenize || tokenBase)(stream, state);
    if (style == "comment") return style;
    if (ctx.align == null) ctx.align = true;

    if (curPunc == "{") pushContext(state, stream.column(), "}");
    else if (curPunc == "[") pushContext(state, stream.column(), "]");
    else if (curPunc == "(") pushContext(state, stream.column(), ")");
    else if (curPunc == "case") ctx.type = "case";
    else if (curPunc == "}" && ctx.type == "}") popContext(state);
    else if (curPunc == ctx.type) popContext(state);
    state.startOfLine = false;
    return style;
  },

  indent: function(state, textAfter, cx) {
    if (state.tokenize != tokenBase && state.tokenize != null) return null;
    var ctx = state.context, firstChar = textAfter && textAfter.charAt(0);
    if (ctx.type == "case" && /^(?:case|default)\b/.test(textAfter)) {
      state.context.type = "}";
      return ctx.indented;
    }
    var closing = firstChar == ctx.type;
    if (ctx.align) return ctx.column + (closing ? 0 : 1);
    else return ctx.indented + (closing ? 0 : cx.unit);
  },

  languageData: {
    indentOnInput: /^\s([{}]|case |default\s*:)$/,
    commentTokens: {line: "//", block: {open: "/*", close: "*/"}}
  }
};
