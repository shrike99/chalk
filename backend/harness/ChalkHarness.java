// Chalk's Java test harness. Compiled next to the student's class and run with the spec file:
//   java -cp out ChalkHarness spec.json StudentClass
// It calls the student's method (or builds their class and makes calls) for each case, converting
// JSON arguments to the method's parameter types, and prints one JSON line per case. Chalk's Python
// side compares the results, so every language is judged the same way.
import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class ChalkHarness {
    static PrintStream out;

    public static void main(String[] argv) throws Exception {
        out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        String specText = new String(Files.readAllBytes(Paths.get(argv[0])), StandardCharsets.UTF_8);
        Files.deleteIfExists(Paths.get(argv[0]));  // the hidden cases don't stay on disk for the code to read
        Map<String, Object> spec = asMap(new Json(specText).value());
        String kind = str(spec.get("kind"), "function");
        String className = argv.length > 1 ? argv[1] : str(spec.get("class_name"), "Solution");
        Class<?> cls;
        try {
            cls = Class.forName(kind.equals("class") ? str(spec.get("class"), className) : className);
        } catch (ClassNotFoundException e) {
            emit(map("compile_error", "Couldn't find a class called " + (kind.equals("class") ? str(spec.get("class"), className) : className) + " in your code."));
            return;
        }
        emit(map("loaded", true, "stdout", ""));
        List<Object> cases = asList(spec.get("cases"));
        long limit = ((Number) spec.getOrDefault("time_limit_ms", 2000L)).longValue();
        for (int i = 0; i < cases.size(); i++) {
            final int idx = i;
            final Map<String, Object> c = asMap(cases.get(i));
            final Map<String, Object> box = new LinkedHashMap<>();
            box.put("i", idx);
            Thread t = new Thread(null, () -> runCase(cls, kind, spec, c, box), "case", 64L << 20);
            t.setDaemon(true);
            t.start();
            long lim = c.containsKey("time_limit_ms") ? ((Number) c.get("time_limit_ms")).longValue() : limit;
            t.join(lim);
            if (t.isAlive()) {
                emit(map("i", idx, "status", "timeout"));
                for (int j = idx + 1; j < cases.size(); j++) emit(map("i", j, "status", "skipped"));
                out.flush();
                Runtime.getRuntime().halt(0);
            }
            emit(box);
        }
        out.flush();
        Runtime.getRuntime().halt(0);
    }

    static void runCase(Class<?> cls, String kind, Map<String, Object> spec, Map<String, Object> c, Map<String, Object> box) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        PrintStream saved = System.out;
        long t0 = System.nanoTime();
        try {
            System.setOut(new PrintStream(buf, true, "UTF-8"));
            if (kind.equals("function")) {
                List<Object> args = asList(c.get("args"));
                String name = str(spec.get("function"), "");
                Method m = pick(cls.getMethods(), cls.getDeclaredMethods(), name, args.size());
                if (m == null) throw new NoSuchMethodException("Couldn't find a method called " + name + " that takes " + args.size() + " argument" + (args.size() == 1 ? "" : "s"));
                m.setAccessible(true);
                Object target = Modifier.isStatic(m.getModifiers()) ? null : newInstance(cls);
                Object got = m.invoke(target, convertAll(args, m.getGenericParameterTypes()));
                box.put("status", "ok");
                box.put("value", toJson(got, m.getReturnType() == void.class));
            } else {
                List<Object> calls = asList(c.get("calls"));
                Object obj = null;
                List<Object> results = new ArrayList<>();
                for (int k = 0; k < calls.size(); k++) {
                    List<Object> call = asList(calls.get(k));
                    String name = (String) call.get(0);
                    List<Object> args = call.size() > 1 ? asList(call.get(1)) : new ArrayList<>();
                    if (k == 0) {
                        Constructor<?> ctor = null;
                        for (Constructor<?> x : cls.getDeclaredConstructors()) if (x.getParameterCount() == args.size()) ctor = x;
                        if (ctor == null) throw new NoSuchMethodException("Couldn't find a constructor for " + cls.getSimpleName() + " that takes " + args.size() + " argument" + (args.size() == 1 ? "" : "s"));
                        ctor.setAccessible(true);
                        obj = ctor.newInstance(convertAll(args, ctor.getGenericParameterTypes()));
                        results.add(null);
                    } else {
                        Method m = pick(cls.getMethods(), cls.getDeclaredMethods(), name, args.size());
                        if (m == null) throw new NoSuchMethodException("Couldn't find a method called " + name + " that takes " + args.size() + " argument" + (args.size() == 1 ? "" : "s"));
                        m.setAccessible(true);
                        Object r = m.invoke(obj, convertAll(args, m.getGenericParameterTypes()));
                        results.add(toJson(r, m.getReturnType() == void.class));
                    }
                }
                box.put("status", "ok");
                box.put("value", results);
            }
        } catch (InvocationTargetException e) {
            fail(box, e.getCause() != null ? e.getCause() : e);
        } catch (Throwable e) {
            fail(box, e);
        } finally {
            System.setOut(saved);
            box.put("ms", Math.round((System.nanoTime() - t0) / 1e5) / 10.0);
            String s = new String(buf.toByteArray(), StandardCharsets.UTF_8);
            box.put("stdout", s.length() > 2000 ? s.substring(s.length() - 2000) : s);
        }
    }

    static void fail(Map<String, Object> box, Throwable e) {
        box.put("status", "error");
        if (e instanceof StackOverflowError) box.put("error", "StackOverflowError: the recursion never stopped (does it reach a base case?)");
        else box.put("error", e.getClass().getSimpleName() + (e.getMessage() != null ? ": " + e.getMessage() : ""));
        for (StackTraceElement el : e.getStackTrace()) {
            if (el.getFileName() != null && !el.getFileName().equals("ChalkHarness.java") && !el.getClassName().startsWith("java.") && !el.getClassName().startsWith("jdk.")) {
                box.put("line", el.getLineNumber());
                break;
            }
        }
    }

    static Method pick(Method[] pub, Method[] decl, String name, int n) {
        for (Method m : decl) if (m.getName().equals(name) && m.getParameterCount() == n) return m;
        for (Method m : pub) if (m.getName().equals(name) && m.getParameterCount() == n) return m;
        return null;
    }

    static Object newInstance(Class<?> cls) throws Exception {
        Constructor<?> c = cls.getDeclaredConstructor();
        c.setAccessible(true);
        return c.newInstance();
    }

    // ---------------------------------------------------------------- JSON -> Java values
    static Object[] convertAll(List<Object> args, Type[] types) {
        Object[] out = new Object[types.length];
        for (int i = 0; i < types.length; i++) out[i] = convert(args.get(i), types[i]);
        return out;
    }

    static Object convert(Object v, Type t) {
        if (t instanceof ParameterizedType) {
            ParameterizedType p = (ParameterizedType) t;
            Class<?> raw = (Class<?>) p.getRawType();
            Type[] a = p.getActualTypeArguments();
            if (v == null) return null;
            if (Map.class.isAssignableFrom(raw)) {
                Map<Object, Object> m = raw.isInterface() || Modifier.isAbstract(raw.getModifiers()) ? new HashMap<>() : newColl(raw);
                for (Map.Entry<String, Object> e : asMap(v).entrySet()) m.put(convert(e.getKey(), a[0]), convert(e.getValue(), a[1]));
                return m;
            }
            Collection<Object> coll = Set.class.isAssignableFrom(raw) ? new LinkedHashSet<>() : Deque.class.isAssignableFrom(raw) || Queue.class.isAssignableFrom(raw) ? new ArrayDeque<>() : new ArrayList<>();
            for (Object x : asList(v)) coll.add(convert(x, a[0]));
            return coll;
        }
        Class<?> c = (Class<?>) t;
        if (v == null) return c.isPrimitive() ? defaultOf(c) : null;
        if (c.isArray()) {
            List<Object> l = asList(v);
            Object arr = Array.newInstance(c.getComponentType(), l.size());
            for (int i = 0; i < l.size(); i++) Array.set(arr, i, convert(l.get(i), c.getComponentType()));
            return arr;
        }
        if (c == int.class || c == Integer.class) return ((Number) v).intValue();
        if (c == long.class || c == Long.class) return ((Number) v).longValue();
        if (c == double.class || c == Double.class) return ((Number) v).doubleValue();
        if (c == float.class || c == Float.class) return ((Number) v).floatValue();
        if (c == short.class || c == Short.class) return ((Number) v).shortValue();
        if (c == byte.class || c == Byte.class) return ((Number) v).byteValue();
        if (c == boolean.class || c == Boolean.class) return v;
        if (c == char.class || c == Character.class) return v instanceof String ? ((String) v).charAt(0) : (char) ((Number) v).intValue();
        if (c == String.class) return String.valueOf(v);
        if (List.class.isAssignableFrom(c) || c == Collection.class || c == Iterable.class) return new ArrayList<>(asList(v));
        if (c == Object.class) return v;
        return v;
    }

    static Object defaultOf(Class<?> c) {
        if (c == boolean.class) return false;
        if (c == char.class) return '\0';
        if (c == double.class) return 0.0;
        if (c == float.class) return 0f;
        if (c == long.class) return 0L;
        return 0;
    }

    @SuppressWarnings("unchecked")
    static <T> T newColl(Class<?> raw) {
        try { return (T) raw.getDeclaredConstructor().newInstance(); } catch (Exception e) { return (T) new HashMap<>(); }
    }

    // ---------------------------------------------------------------- Java values -> JSON
    static Object toJson(Object v, boolean isVoid) {
        if (isVoid) return null;
        if (v == null) return null;
        if (v.getClass().isArray()) {
            List<Object> l = new ArrayList<>();
            for (int i = 0; i < Array.getLength(v); i++) l.add(toJson(Array.get(v, i), false));
            return l;
        }
        if (v instanceof Collection) {
            List<Object> l = new ArrayList<>();
            for (Object x : (Collection<?>) v) l.add(toJson(x, false));
            return l;
        }
        if (v instanceof Map) {
            Map<String, Object> m = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) m.put(String.valueOf(e.getKey()), toJson(e.getValue(), false));
            return m;
        }
        if (v instanceof Character) return String.valueOf(v);
        if (v instanceof Number || v instanceof Boolean || v instanceof String) return v;
        return String.valueOf(v);
    }

    // ---------------------------------------------------------------- output
    static void emit(Object o) {
        StringBuilder sb = new StringBuilder();
        write(sb, o);
        out.println(sb);
        out.flush();
    }

    static void write(StringBuilder sb, Object o) {
        if (o == null) sb.append("null");
        else if (o instanceof String) {
            sb.append('"');
            for (char ch : ((String) o).toCharArray()) {
                switch (ch) {
                    case '"': sb.append("\\\""); break;
                    case '\\': sb.append("\\\\"); break;
                    case '\n': sb.append("\\n"); break;
                    case '\r': sb.append("\\r"); break;
                    case '\t': sb.append("\\t"); break;
                    default: if (ch < 0x20) sb.append(String.format("\\u%04x", (int) ch)); else sb.append(ch);
                }
            }
            sb.append('"');
        } else if (o instanceof Double || o instanceof Float) {
            double d = ((Number) o).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) sb.append("null");
            else if (d == Math.rint(d) && Math.abs(d) < 1e15) sb.append((long) d).append(".0");
            else sb.append(d);
        } else if (o instanceof Number || o instanceof Boolean) sb.append(o);
        else if (o instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                if (!first) sb.append(',');
                first = false;
                write(sb, String.valueOf(e.getKey()));
                sb.append(':');
                write(sb, e.getValue());
            }
            sb.append('}');
        } else if (o instanceof List) {
            sb.append('[');
            boolean first = true;
            for (Object x : (List<?>) o) {
                if (!first) sb.append(',');
                first = false;
                write(sb, x);
            }
            sb.append(']');
        } else write(sb, String.valueOf(o));
    }

    static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> asMap(Object o) { return o == null ? new LinkedHashMap<>() : (Map<String, Object>) o; }

    @SuppressWarnings("unchecked")
    static List<Object> asList(Object o) { return o == null ? new ArrayList<>() : (List<Object>) o; }

    static String str(Object o, String dflt) { return o == null ? dflt : String.valueOf(o); }

    // ---------------------------------------------------------------- a small JSON reader
    static final class Json {
        final String s;
        int i = 0;
        Json(String s) { this.s = s; }

        Object value() {
            ws();
            char c = s.charAt(i);
            if (c == '{') {
                i++;
                Map<String, Object> m = new LinkedHashMap<>();
                ws();
                if (s.charAt(i) == '}') { i++; return m; }
                while (true) {
                    ws();
                    String k = string();
                    ws(); i++; // :
                    m.put(k, value());
                    ws();
                    if (s.charAt(i++) == '}') return m;
                }
            }
            if (c == '[') {
                i++;
                List<Object> l = new ArrayList<>();
                ws();
                if (s.charAt(i) == ']') { i++; return l; }
                while (true) {
                    l.add(value());
                    ws();
                    if (s.charAt(i++) == ']') return l;
                }
            }
            if (c == '"') return string();
            if (s.startsWith("true", i)) { i += 4; return true; }
            if (s.startsWith("false", i)) { i += 5; return false; }
            if (s.startsWith("null", i)) { i += 4; return null; }
            int st = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            String num = s.substring(st, i);
            if (num.contains(".") || num.contains("e") || num.contains("E")) return Double.parseDouble(num);
            long l = Long.parseLong(num);
            return l;
        }

        String string() {
            StringBuilder sb = new StringBuilder();
            i++; // opening quote
            while (true) {
                char c = s.charAt(i++);
                if (c == '"') return sb.toString();
                if (c == '\\') {
                    char e = s.charAt(i++);
                    switch (e) {
                        case 'n': sb.append('\n'); break;
                        case 't': sb.append('\t'); break;
                        case 'r': sb.append('\r'); break;
                        case 'b': sb.append('\b'); break;
                        case 'f': sb.append('\f'); break;
                        case 'u': sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                        default: sb.append(e);
                    }
                } else sb.append(c);
            }
        }

        void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
    }
}
