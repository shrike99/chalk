"""Java, C and SQL: right answers, wrong answers, compile errors, crashes, hangs, classes, programs."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runner  # noqa: E402
import toolchains  # noqa: E402

needs_java = pytest.mark.skipif(toolchains.find_java() is None, reason="no JDK here")
needs_c = pytest.mark.skipif(toolchains.find_c() is None, reason="no C compiler here")


def st(r):
    return [c["status"] for c in r["results"]]


# ================================================================ SQL
SCHEMA = """
CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, year INTEGER, mark REAL);
INSERT INTO students VALUES (1, 'Ada', 2, 71.5), (2, 'Ben', 1, 58), (3, 'Cy', 2, 64), (4, 'Di', 3, 80);
"""
TOP = {"kind": "query", "schema": SCHEMA, "cases": [
    {"expected": [["Di", 80.0], ["Ada", 71.5]], "ordered": True},
    {"setup": "INSERT INTO students VALUES (5, 'Ed', 2, 80);", "expected": [["Di", 80.0], ["Ed", 80.0]], "ordered": False},
    {"setup": "DELETE FROM students;", "expected": []},
]}


def test_sql_right():
    r = runner.run_sql("SELECT name, mark FROM students ORDER BY mark DESC LIMIT 2;", TOP)
    assert st(r) == ["pass", "pass", "pass"]


def test_sql_wrong_order_and_missing_limit():
    r = runner.run_sql("SELECT name, mark FROM students ORDER BY mark ASC", TOP)
    assert st(r) == ["fail", "fail", "pass"] and '"rows"' in r["results"][0]["got"]


def test_sql_error_and_multiple_statements():
    r = runner.run_sql("SELECT nam FROM students;", TOP)
    assert r["results"][0]["status"] == "error" and "no such column" in r["results"][0]["error"]
    r = runner.run_sql("CREATE TEMP VIEW v AS SELECT name, mark FROM students;\nSELECT * FROM v ORDER BY mark DESC LIMIT 2", TOP)
    assert st(r) == ["pass", "pass", "pass"]


def test_sql_update_checked_with_a_query():
    spec = {"kind": "query", "schema": SCHEMA, "cases": [
        {"check": "SELECT name, year FROM students ORDER BY id", "expected": [["Ada", 3], ["Ben", 2], ["Cy", 3], ["Di", 4]]}]}
    assert st(runner.run_sql("UPDATE students SET year = year + 1;", spec)) == ["pass"]
    assert st(runner.run_sql("UPDATE students SET year = 1;", spec)) == ["fail"]


def test_sql_runaway_query_times_out():
    spec = {"kind": "query", "schema": SCHEMA, "time_limit_ms": 300, "cases": [{"expected": []}]}
    q = "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT count(*) FROM n;"
    assert st(runner.run_sql(q, spec)) == ["timeout"]


def test_sql_empty():
    assert "Write a query" in runner.run_sql("   ", TOP)["compile_error"]


# ================================================================ Java
TWO_SUM_J = {"kind": "function", "function": "twoSum", "compare": "unordered", "cases": [
    {"args": [[2, 7, 11, 15], 9], "expected": [0, 1]},
    {"args": [[3, 3], 6], "expected": [0, 1]},
    {"args": [[1, 2], 7], "expected": None},
]}
GOOD_J = """import java.util.*;
class Solution {
    public int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            Integer j = seen.get(target - nums[i]);
            if (j != null) return new int[] {j, i};
            seen.put(nums[i], i);
        }
        return null;
    }
}"""


@needs_java
def test_java_right_and_wrong():
    assert st(runner.run_java(GOOD_J, TWO_SUM_J)) == ["pass", "pass", "pass"]
    wrong = GOOD_J.replace("return null;", "return new int[0];")
    r = runner.run_java(wrong, TWO_SUM_J)
    assert st(r) == ["pass", "pass", "fail"] and r["results"][2]["got"] == "[]"


@needs_java
def test_java_compile_error_with_line():
    r = runner.run_java(GOOD_J.replace("seen.put(nums[i], i);", "seen.put(nums[i], i)"), TWO_SUM_J)
    assert "';' expected" in r["compile_error"] and r["line"] == 8


@needs_java
def test_java_exception_and_timeout_and_recursion():
    crash = "class Solution { public int[] twoSum(int[] nums, int target) { return new int[] {nums[5], 0}; } }"
    r = runner.run_java(crash, TWO_SUM_J)
    assert r["results"][0]["status"] == "error" and "ArrayIndexOutOfBounds" in r["results"][0]["error"] and r["results"][0]["line"] == 1
    loop = "class Solution { public int[] twoSum(int[] nums, int target) { if (target == 6) while (true) {} return new int[] {0, 1}; } }"
    assert st(runner.run_java(loop, {**TWO_SUM_J, "time_limit_ms": 800})) == ["pass", "timeout", "skipped"]
    rec = "class Solution { static int f(int n) { return f(n + 1) + 1; } public static int g(int n) { return f(n); } }"
    r = runner.run_java(rec, {"kind": "function", "function": "g", "cases": [{"args": [0], "expected": 1}]})
    assert "StackOverflowError" in r["results"][0]["error"]


@needs_java
def test_java_types_static_lists_strings_doubles_prints():
    code = """import java.util.*;
public class Tools {
    public static List<String> shout(List<String> words) { System.out.println("n=" + words.size()); List<String> out = new ArrayList<>(); for (String w : words) out.add(w.toUpperCase()); return out; }
    public static double mean(int[] a) { double s = 0; for (int x : a) s += x; return s / a.length; }
    public static boolean isPal(String s) { return new StringBuilder(s).reverse().toString().equals(s); }
    public static char first(String s) { return s.charAt(0); }
    public static long big(long a) { return a * 2; }
    public static int[][] grid(int n) { return new int[n][n]; }
}"""
    cases = lambda fn, c: {"kind": "function", "function": fn, "cases": c}
    r = runner.run_java(code, cases("shout", [{"args": [["hi", "yo"]], "expected": ["HI", "YO"]}]))
    assert st(r) == ["pass"] and r["results"][0]["stdout"].strip() == "n=2"
    assert st(runner.run_java(code, {**cases("mean", [{"args": [[1, 2]], "expected": 1.5}]), "compare": "approx"})) == ["pass"]
    assert st(runner.run_java(code, cases("isPal", [{"args": ["abba"], "expected": True}, {"args": ["ab"], "expected": False}]))) == ["pass", "pass"]
    assert st(runner.run_java(code, cases("first", [{"args": ["xyz"], "expected": "x"}]))) == ["pass"]
    assert st(runner.run_java(code, cases("big", [{"args": [5000000000], "expected": 10000000000}]))) == ["pass"]
    assert st(runner.run_java(code, cases("grid", [{"args": [2], "expected": [[0, 0], [0, 0]]}]))) == ["pass"]


@needs_java
def test_java_class_calls():
    code = """import java.util.*;
class MinStack {
    private final Deque<int[]> s = new ArrayDeque<>();
    public MinStack() {}
    public void push(int x) { int m = s.isEmpty() ? x : Math.min(x, s.peek()[1]); s.push(new int[] {x, m}); }
    public void pop() { s.pop(); }
    public int getMin() { return s.peek()[1]; }
}"""
    spec = {"kind": "class", "class": "MinStack", "cases": [
        {"calls": [["MinStack", []], ["push", [3]], ["push", [1]], ["getMin", []], ["pop", []], ["getMin", []]], "expected": [None, None, None, 1, None, 3]}]}
    assert st(runner.run_java(code, spec)) == ["pass"]


@needs_java
def test_java_program_with_stdin():
    code = "import java.util.*;\npublic class Main { public static void main(String[] a) { Scanner s = new Scanner(System.in); int x = s.nextInt(), y = s.nextInt(); System.out.println(x + y); } }"
    spec = {"kind": "program", "cases": [{"stdin": "3 4\n", "expected_stdout": "7"}, {"stdin": "x\n", "expected_stdout": "1"}]}
    r = runner.run_java(code, spec)
    assert st(r) == ["pass", "error"] and "InputMismatchException" in r["results"][1]["error"]


@needs_java
def test_java_missing_method():
    r = runner.run_java("class Solution { public int other(int a) { return a; } }", {"kind": "function", "function": "twoSum", "cases": [{"args": [1, 2], "expected": 3}]})
    assert r["results"][0]["status"] == "error" and "twoSum" in r["results"][0]["error"]


# ================================================================ C
SUM = {"kind": "function", "signature": "int sum_array(int *a, int n)", "cases": [
    {"args": [[1, 2, 3], 3], "expected": 6}, {"args": [[], 0], "expected": 0}, {"args": [[-5, 5], 2], "expected": 0}]}


@needs_c
def test_c_right_wrong_and_empty_array():
    good = "int sum_array(int *a, int n) { int s = 0; for (int i = 0; i < n; i++) s += a[i]; return s; }"
    assert st(runner.run_c(good, SUM)) == ["pass", "pass", "pass"]
    off_by_one = "int sum_array(int *a, int n) { int s = 0; for (int i = 1; i < n; i++) s += a[i]; return s; }"
    assert st(runner.run_c(off_by_one, SUM)) == ["fail", "pass", "fail"]


@needs_c
def test_c_compile_error_line_and_signature_mismatch():
    r = runner.run_c("int sum_array(int *a, int n) {\n  return a[0]\n}", SUM)
    assert r["compile_error"] and r["line"] in (2, 3)
    r = runner.run_c("double sum_array(double *a, int n) { return 0; }", SUM)
    assert "doesn't match" in r["compile_error"] and "int sum_array(int *a, int n)" in r["compile_error"]
    # adding const is harmless and allowed
    assert st(runner.run_c("int sum_array(const int *a, int n) { int s = 0; for (int i = 0; i < n; i++) s += a[i]; return s; }", SUM)) == ["pass", "pass", "pass"]


@needs_c
def test_c_segfault_and_hang():
    crash = "#include <stddef.h>\nint sum_array(int *a, int n) { int *p = NULL; return *p; }"
    r = runner.run_c(crash, SUM)
    assert r["results"][0]["status"] == "error" and "segmentation" in r["results"][0]["error"].lower()
    hang = "int sum_array(int *a, int n) { while (n == 0) {} return 6; }"
    assert st(runner.run_c(hang, {**SUM, "time_limit_ms": 500})) == ["pass", "timeout", "skipped"]


@needs_c
def test_c_in_place_strings_bools_doubles_and_their_main():
    rev = {"kind": "function", "signature": "void reverse(char *s)", "cases": [
        {"args": ["hello"], "expected_args": {"0": "olleh"}}, {"args": [""], "expected_args": {"0": ""}}]}
    code = "#include <string.h>\nvoid reverse(char *s) { int n = strlen(s); for (int i = 0; i < n / 2; i++) { char t = s[i]; s[i] = s[n-1-i]; s[n-1-i] = t; } }\nint main(void) { return 0; }"
    assert st(runner.run_c(code, rev)) == ["pass", "pass"]  # their own main() doesn't get in the way
    sort = {"kind": "function", "signature": "void sort(int a[], int n)", "cases": [{"args": [[3, 1, 2], 3], "expected_args": {"0": [1, 2, 3]}}]}
    bubble = "void sort(int a[], int n) { for (int i = 0; i < n; i++) for (int j = 0; j + 1 < n - i; j++) if (a[j] > a[j+1]) { int t = a[j]; a[j] = a[j+1]; a[j+1] = t; } }"
    assert st(runner.run_c(bubble, sort)) == ["pass"]
    r = runner.run_c("void sort(int a[], int n) { }", sort)
    assert st(r) == ["fail"] and "argument 1 afterwards" in r["results"][0]["got"]
    even = {"kind": "function", "signature": "bool is_even(int n)", "cases": [{"args": [4], "expected": True}, {"args": [3], "expected": False}]}
    assert st(runner.run_c("#include <stdbool.h>\nbool is_even(int n) { return n % 2 == 0; }", even)) == ["pass", "pass"]
    avg = {"kind": "function", "signature": "double mean(const int *a, int n)", "compare": "approx", "cases": [{"args": [[1, 2], 2], "expected": 1.5}]}
    assert st(runner.run_c("double mean(const int *a, int n) { double s = 0; for (int i = 0; i < n; i++) s += a[i]; return s / n; }", avg)) == ["pass"]
    greet = {"kind": "function", "signature": "const char *grade(int mark)", "cases": [{"args": [75], "expected": "A"}, {"args": [10], "expected": "F"}]}
    assert st(runner.run_c('const char *grade(int mark) { return mark >= 70 ? "A" : "F"; }', greet)) == ["pass", "pass"]


@needs_c
def test_c_prints_are_kept_separately():
    spec = {"kind": "function", "signature": "int twice(int x)", "cases": [{"args": [4], "expected": 8}]}
    r = runner.run_c('#include <stdio.h>\nint twice(int x) { printf("debug %d", x); return 2 * x; }', spec)
    assert st(r) == ["pass"] and r["results"][0]["stdout"] == "debug 4"


@needs_c
def test_c_program_with_stdin():
    code = '#include <stdio.h>\nint main(void) { int a, b; if (scanf("%d %d", &a, &b) != 2) return 1; printf("%d\\n", a + b); return 0; }'
    spec = {"kind": "program", "cases": [{"stdin": "3 4", "expected_stdout": "7"}, {"stdin": "", "expected_stdout": "0"}]}
    assert st(runner.run_c(code, spec)) == ["pass", "error"]


def test_c_signatures():
    s = runner.parse_c_signature("int two_sum(const int *nums, int n, int target);")
    assert s["name"] == "two_sum" and [p["kind"] for p in s["params"]] == ["array", "scalar", "scalar"]
    assert runner.parse_c_signature("void f(void)")["params"] == []
    assert runner.parse_c_signature("char *rev(char s[])")["ret"] == "string"
    for bad in ("int *range(int n)", "struct node *f(int x)", "int f(int **grid, int n)", "nonsense"):
        with pytest.raises(ValueError):
            runner.parse_c_signature(bad)


def test_missing_toolchain_is_reported(monkeypatch):
    monkeypatch.setattr(toolchains, "java", lambda: None)
    monkeypatch.setattr(toolchains, "cc", lambda: None)
    assert runner.run("java", "class A {}", TWO_SUM_J)["missing"] == "java"
    assert runner.run("c", "int f(void){return 0;}", SUM)["missing"] == "c"
