import sys
import ast
import json
import importlib.util
import re

class Scope:
    def __init__(self, parent=None, scope_type='global', name=''):
        self.parent = parent
        self.scope_type = scope_type  # 'global', 'function', 'class'
        self.name = name
        self.symbols = {}  # name -> symbol_dict
        self.assigned_states = {}  # name -> 'ASSIGNED' | 'POSSIBLY_ASSIGNED' | 'UNASSIGNED'
        self.bound_names = set()
        self.global_names = set()
        self.nonlocal_names = set()
        self.children = []
        if parent:
            parent.children.append(self)

    def define(self, name, kind, type_hint=None, node=None, methods=None, attributes=None):
        self.symbols[name] = {
            'name': name,
            'kind': kind,  # 'variable', 'function', 'class', 'parameter', 'import', 'builtin'
            'type_hint': type_hint,
            'node': node,
            'methods': methods or {},
            'attributes': attributes or set(),
            'used': False,
            'is_loop_var': False
        }

    def lookup(self, name, search_class=False):
        curr = self
        while curr:
            if curr.scope_type == 'class' and not search_class:
                # Inside python methods, the class scope is skipped for normal name resolution
                curr = curr.parent
                continue
            if name in curr.symbols:
                return curr.symbols[name]
            curr = curr.parent
        return None

    def mark_used(self, name):
        curr = self
        while curr:
            if curr.scope_type == 'class':
                curr = curr.parent
                continue
            if name in curr.symbols:
                curr.symbols[name]['used'] = True
                return True
            curr = curr.parent
        return False

def get_bound_names_at_level(nodes):
    bound = set()
    global_names = set()
    nonlocal_names = set()
    
    def visit(node):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
            return  # Inner scopes are handled when entering them
        
        if isinstance(node, ast.Name):
            if isinstance(node.ctx, ast.Store):
                bound.add(node.id)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
        elif isinstance(node, ast.Global):
            global_names.update(node.names)
        elif isinstance(node, ast.Nonlocal):
            nonlocal_names.update(node.names)
        elif isinstance(node, ast.Import):
            for name in node.names:
                bound.add(name.asname or name.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            for name in node.names:
                bound.add(name.asname or name.name)
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name):
                bound.add(node.target.id)
                
        for child in ast.iter_child_nodes(node):
            visit(child)
            
    for node in nodes:
        visit(node)
    return bound, global_names, nonlocal_names

class PythonStaticAnalyzer(ast.NodeVisitor):
    def __init__(self, code):
        self.code = code
        self.lines = code.splitlines()
        self.errors = []
        self.seen_keys = set()
        
        # Scopes stack
        self.global_scope = Scope(scope_type='global', name='global')
        self.scopes = [self.global_scope]
        
        # Register standard built-ins
        builtins = {
            'print', 'len', 'range', 'type', 'isinstance', 'int', 'str', 'float', 'bool',
            'list', 'dict', 'set', 'tuple', 'input', 'open', 'enumerate', 'zip', 'map',
            'filter', 'sorted', 'reversed', 'sum', 'min', 'max', 'abs', 'round', 'id',
            'hasattr', 'getattr', 'setattr', 'delattr', 'callable', 'iter', 'next',
            'super', 'object', 'property', 'staticmethod', 'classmethod',
            'NotImplementedError', 'ValueError', 'TypeError', 'KeyError',
            'IndexError', 'AttributeError', 'Exception', 'RuntimeError',
            'StopIteration', 'None', 'True', 'False', '__name__', '__init__',
            '__str__', '__repr__', '__len__', '__eq__', '__lt__', '__gt__',
            'self', 'cls', 'args', 'kwargs'
        }
        for b in builtins:
            self.global_scope.define(b, kind='builtin')
            self.global_scope.assigned_states[b] = 'ASSIGNED'
            
        # Class registry (className -> ClassSymbol)
        self.classes = {}
        
        # Function registry (funcName -> FunctionSymbol)
        self.functions = {}
        
        # Unreachable code tracking
        self.unreachable = False
        
        # Context tracking
        self.inside_staticmethod = False
        self.inside_classmethod = False
        self.inside_with_context = False
        self.active_loop_targets = []

    @property
    def current_scope(self):
        return self.scopes[-1]

    @property
    def current_component(self):
        curr = self.current_scope
        while curr:
            if curr.scope_type == 'class':
                return curr.name
            curr = curr.parent
        return 'Global'

    def add_error(self, node, severity, issue_type, explanation, suggestion, symbol=''):
        lineno = getattr(node, 'lineno', 1)
        col_offset = getattr(node, 'col_offset', 0) + 1
        
        # Build deduplication key
        key = f"{issue_type}:{lineno}:{symbol}"
        if key in self.seen_keys:
            return
        self.seen_keys.add(key)
        
        self.errors.append({
            'line': lineno,
            'column': col_offset,
            'severity': severity,
            'category': 'ERROR' if severity in ('Critical', 'High') else ('WARNING' if severity == 'Medium' else 'INFO'),
            'issueType': issue_type,
            'explanation': explanation,
            'suggestion': suggestion,
            'component': self.current_component,
            'symbol': symbol
        })

    def parse_annotation(self, node):
        if isinstance(node, ast.Name):
            return node.id
        elif isinstance(node, ast.Subscript):
            value = self.parse_annotation(node.value)
            slice_node = node.slice
            if isinstance(slice_node, ast.Tuple):
                elts = [self.parse_annotation(elt) for elt in slice_node.elts]
                return f"{value}[{','.join(elts)}]"
            elif hasattr(slice_node, 'value') and not isinstance(slice_node, ast.Name):
                return f"{value}[{self.parse_annotation(slice_node.value)}]"
            else:
                return f"{value}[{self.parse_annotation(slice_node)}]"
        elif isinstance(node, ast.Constant):
            return str(node.value)
        elif isinstance(node, ast.Attribute):
            return f"{self.parse_annotation(node.value)}.{node.attr}"
        return 'unknown'

    def infer_type(self, node):
        if isinstance(node, ast.Constant):
            val = node.value
            if isinstance(val, bool): return 'bool'
            if isinstance(val, int): return 'int'
            if isinstance(val, float): return 'float'
            if isinstance(val, str): return 'str'
            if val is None: return 'None'
        elif isinstance(node, ast.List):
            if not node.elts:
                return 'list'
            first_type = self.infer_type(node.elts[0])
            return f"list[{first_type}]"
        elif isinstance(node, ast.Dict):
            if not node.keys:
                return 'dict'
            k_type = self.infer_type(node.keys[0])
            v_type = self.infer_type(node.values[0])
            return f"dict[{k_type},{v_type}]"
        elif isinstance(node, ast.Name):
            sym = self.current_scope.lookup(node.id)
            if sym and sym.get('type_hint'):
                return sym['type_hint']
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                func_name = node.func.id
                if func_name == 'str': return 'str'
                if func_name == 'int': return 'int'
                if func_name == 'float': return 'float'
                if func_name == 'bool': return 'bool'
                sym = self.current_scope.lookup(func_name)
                if sym and sym['kind'] == 'class':
                    return sym['name']
            elif isinstance(node.func, ast.Attribute):
                receiver_type = self.infer_type(node.func.value)
                method_name = node.func.attr
                if receiver_type and receiver_type.startswith(('dict[', 'Dict[')) and method_name == 'get':
                    parts = receiver_type.split('[', 1)[1].rsplit(']', 1)[0].split(',')
                    if len(parts) == 2:
                        return parts[1].strip()
        return 'unknown'

    def check_type_compatibility(self, hint, val_type):
        if hint == 'unknown' or val_type == 'unknown':
            return True
        if hint == val_type:
            return True
        if hint == 'float' and val_type == 'int':
            return True
        if hint.startswith(('list[', 'List[')) and val_type == 'list':
            return True
        if hint.startswith(('dict[', 'Dict[')) and val_type == 'dict':
            return True
        if hint.lower() == val_type.lower():
            return True
        return False

    def is_block_terminated(self, statements):
        for stmt in statements:
            if isinstance(stmt, (ast.Return, ast.Break, ast.Continue, ast.Raise)):
                return True
            if isinstance(stmt, ast.If):
                if self.is_block_terminated(stmt.body) and stmt.orelse and self.is_block_terminated(stmt.orelse):
                    return True
        return False

    def walk_block(self, statements):
        prev_unreachable = self.unreachable
        for stmt in statements:
            if self.unreachable:
                if not isinstance(stmt, ast.Pass) and not (isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant)):
                    self.add_error(
                        stmt, 
                        severity='Critical', 
                        issue_type='RULE SET 2 — CONTROL FLOW', 
                        explanation='Unreachable code detected', 
                        suggestion='Remove or move this statement.'
                    )
            
            self.visit(stmt)
            
            if isinstance(stmt, (ast.Return, ast.Break, ast.Continue, ast.Raise)):
                self.unreachable = True
            elif isinstance(stmt, ast.If):
                if self.is_block_terminated(stmt.body) and stmt.orelse and self.is_block_terminated(stmt.orelse):
                    self.unreachable = True
                    
        self.unreachable = prev_unreachable

    def analyze_function_body(self, node, params):
        func_scope = Scope(parent=self.current_scope, scope_type='function', name=node.name)
        self.scopes.append(func_scope)
        
        bound, globals_in_func, nonlocals_in_func = get_bound_names_at_level(node.body)
        func_scope.bound_names = bound
        func_scope.global_names = globals_in_func
        func_scope.nonlocal_names = nonlocals_in_func
        
        for p in params:
            func_scope.define(p, kind='parameter')
            func_scope.assigned_states[p] = 'ASSIGNED'
            
        for name in bound:
            if name not in params:
                func_scope.define(name, kind='variable')
                func_scope.assigned_states[name] = 'UNASSIGNED'
                
        self.walk_block(node.body)
        self.scopes.pop()

    def visit_Module(self, node):
        bound, global_names, nonlocal_names = get_bound_names_at_level(node.body)
        self.global_scope.bound_names = bound
        
        for name in bound:
            if name not in self.global_scope.symbols:
                self.global_scope.define(name, kind='variable')
                self.global_scope.assigned_states[name] = 'UNASSIGNED'
                
        self.walk_block(node.body)

    def visit_FunctionDef(self, node):
        func_name = node.name
        self.current_scope.assigned_states[func_name] = 'ASSIGNED'
        
        # Check duplicate methods within class
        if self.current_scope.scope_type == 'class':
            if func_name in self.current_scope.symbols:
                self.add_error(
                    node,
                    severity='Medium',
                    issue_type='RULE SET 3 — FUNCTIONS',
                    explanation=f"Duplicate method definition: {func_name}",
                    suggestion=f"# Rename or delete duplicate method '{func_name}'",
                    symbol=func_name
                )
            self.current_scope.define(func_name, kind='function', node=node)
            
        self.current_scope.define(func_name, kind='function', node=node)
        self.functions[func_name] = node
        
        # Check for non-standard names
        if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', func_name):
            self.add_error(
                node,
                severity='Medium',
                issue_type='RULE SET 1 — PYTHON BASICS',
                explanation=f"Invalid function name '{func_name}' (starting with number or special chars except _)",
                suggestion=f"# Rename '{func_name}' to match standard identifier rules",
                symbol=func_name
            )

        # Check mutable default arguments
        for default in node.args.defaults:
            if isinstance(default, (ast.List, ast.Dict, ast.Set)):
                self.add_error(
                    default,
                    severity='Critical',
                    issue_type='RULE SET 3 — FUNCTIONS',
                    explanation="Mutable default argument (e.g. list/dict/set default) is a critical bug.",
                    suggestion="def f(x=None): if x is None: x = []"
                )
        for default in node.args.kw_defaults:
            if default and isinstance(default, (ast.List, ast.Dict, ast.Set)):
                self.add_error(
                    default,
                    severity='Critical',
                    issue_type='RULE SET 3 — FUNCTIONS',
                    explanation="Mutable default argument (e.g. list/dict/set default) is a critical bug.",
                    suggestion="def f(x=None): if x is None: x = []"
                )

        # OOP method constraints checks
        is_method = self.current_scope.scope_type == 'class'
        is_staticmethod = False
        is_classmethod = False
        
        if is_method:
            for dec in node.decorator_list:
                if isinstance(dec, ast.Name):
                    if dec.id == 'staticmethod':
                        is_staticmethod = True
                    elif dec.id == 'classmethod':
                        is_classmethod = True
            
            args_list = node.args.args
            if is_staticmethod:
                # static methods should not have self or cls as first argument
                if args_list and args_list[0].arg in ('self', 'cls'):
                    self.add_error(
                        node,
                        severity='Medium',
                        issue_type='RULE SET 5 — OOP',
                        explanation="Static method should not have 'self' or 'cls' as first parameter",
                        suggestion=f"def {func_name}(...): # Remove self/cls parameter",
                        symbol=func_name
                    )
            elif is_classmethod:
                if not args_list or args_list[0].arg != 'cls':
                    self.add_error(
                        node,
                        severity='Medium',
                        issue_type='RULE SET 5 — OOP',
                        explanation="Class method must have 'cls' as its first parameter",
                        suggestion=f"def {func_name}(cls, ...):",
                        symbol=func_name
                    )
            else:
                # Instance method
                if not args_list or args_list[0].arg != 'self':
                    self.add_error(
                        node,
                        severity='Medium',
                        issue_type='RULE SET 5 — OOP',
                        explanation="Instance method must have 'self' as its first parameter",
                        suggestion=f"def {func_name}(self, ...):",
                        symbol=func_name
                    )

        params = []
        for arg in node.args.args:
            params.append(arg.arg)
            # Parameter naming convention check
            if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', arg.arg):
                self.add_error(
                    arg,
                    severity='Medium',
                    issue_type='RULE SET 1 — PYTHON BASICS',
                    explanation=f"Invalid parameter name '{arg.arg}'",
                    suggestion=f"# Rename parameter '{arg.arg}'",
                    symbol=arg.arg
                )
        if node.args.vararg:
            params.append(node.args.vararg.arg)
        if node.args.kwarg:
            params.append(node.args.kwarg.arg)
            
        # Traverse body with decorators context
        old_staticmethod = self.inside_staticmethod
        old_classmethod = self.inside_classmethod
        self.inside_staticmethod = is_staticmethod
        self.inside_classmethod = is_classmethod
        
        self.analyze_function_body(node, params)
        
        self.inside_staticmethod = old_staticmethod
        self.inside_classmethod = old_classmethod

    def visit_AsyncFunctionDef(self, node):
        self.visit_FunctionDef(node)

    def visit_ClassDef(self, node):
        class_name = node.name
        self.current_scope.assigned_states[class_name] = 'ASSIGNED'
        self.current_scope.define(class_name, kind='class', node=node)
        
        # Check invalid class naming
        if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', class_name):
            self.add_error(
                node,
                severity='Medium',
                issue_type='RULE SET 1 — PYTHON BASICS',
                explanation=f"Invalid class name '{class_name}'",
                suggestion=f"# Rename class '{class_name}'",
                symbol=class_name
            )

        class_scope = Scope(parent=self.current_scope, scope_type='class', name=class_name)
        self.scopes.append(class_scope)
        self.classes[class_name] = class_scope
        
        bases = []
        for base in node.bases:
            if isinstance(base, ast.Name):
                bases.append(base.id)
        class_scope.symbols['__bases__'] = bases
        
        self.walk_block(node.body)
        self.scopes.pop()

    def visit_Name(self, node):
        name = node.id
        if isinstance(node.ctx, ast.Load):
            self.current_scope.mark_used(name)
            
            # Static / Class method body constraints check
            if self.inside_staticmethod:
                if name in ('self', 'cls'):
                    self.add_error(
                        node,
                        severity='Critical',
                        issue_type='RULE SET 5 — OOP',
                        explanation=f"@staticmethod cannot access '{name}'",
                        suggestion=f"# Remove reference to '{name}' or change to normal/classmethod",
                        symbol=name
                    )
            elif self.inside_classmethod:
                if name == 'self':
                    self.add_error(
                        node,
                        severity='Critical',
                        issue_type='RULE SET 5 — OOP',
                        explanation="Class method cannot access instance attributes via 'self'",
                        suggestion="Use 'cls' instead or change to instance method",
                        symbol='self'
                    )

            sym = self.current_scope.lookup(name)
            
            # Definite assignment check
            is_local = False
            curr = self.current_scope
            while curr:
                if name in curr.bound_names:
                    is_local = True
                    break
                curr = curr.parent
                
            if is_local:
                curr = self.current_scope
                while curr:
                    if name in curr.assigned_states:
                        state = curr.assigned_states[name]
                        sym_info = curr.symbols.get(name)
                        
                        if state in ('UNASSIGNED', 'POSSIBLY_ASSIGNED'):
                            self.add_error(
                                node,
                                severity='Critical',
                                issue_type='RULE SET 1 — PYTHON BASICS',
                                explanation=f"Local variable '{name}' may be referenced before assignment",
                                suggestion=f"{name} = None",
                                symbol=name
                            )
                        elif sym_info and sym_info.get('is_loop_var') and not any(name in outer for outer in self.active_loop_targets):
                            # Loop variable reused after loop ends warning
                            self.add_error(
                                node,
                                severity='Medium',
                                issue_type='RULE SET 2 — CONTROL FLOW',
                                explanation=f"Loop variable '{name}' reused after loop ends without reassignment",
                                suggestion=f"{name} = None  # Reassign or use a different variable name",
                                symbol=name
                            )
                        break
                    curr = curr.parent
            else:
                if not sym:
                    self.add_error(
                        node,
                        severity='Critical',
                        issue_type='RULE SET 1 — PYTHON BASICS',
                        explanation=f"Undefined name '{name}' used in expression",
                        suggestion=f"{name} = None",
                        symbol=name
                    )
        elif isinstance(node.ctx, ast.Store):
            # Verify variable naming conventions on assignment
            if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', name):
                self.add_error(
                    node,
                    severity='Medium',
                    issue_type='RULE SET 1 — PYTHON BASICS',
                    explanation=f"Invalid variable name '{name}'",
                    suggestion=f"# Rename variable to match naming standards",
                    symbol=name
                )

    def visit_Assign(self, node):
        self.visit(node.value)
        inferred = self.infer_type(node.value)
        
        for target in node.targets:
            if isinstance(target, ast.Name):
                name = target.id
                curr = self.current_scope
                found_scope = None
                while curr:
                    if name in curr.bound_names:
                        found_scope = curr
                        break
                    curr = curr.parent
                if not found_scope:
                    found_scope = self.global_scope
                    
                found_scope.assigned_states[name] = 'ASSIGNED'
                
                sym = found_scope.symbols.get(name)
                if sym:
                    sym['type_hint'] = inferred
                else:
                    found_scope.define(name, kind='variable', type_hint=inferred, node=target)
                    found_scope.assigned_states[name] = 'ASSIGNED'
                    
            elif isinstance(target, ast.Subscript):
                self.visit(target.value)
                self.visit(target.slice)
                
                if isinstance(target.value, ast.Name):
                    dict_name = target.value.id
                    sym = self.current_scope.lookup(dict_name)
                    if sym and sym.get('type_hint'):
                        hint = sym['type_hint']
                        if hint.startswith(('dict[', 'Dict[')):
                            inner = hint.split('[', 1)[1].rsplit(']', 1)[0]
                            parts = inner.split(',')
                            if len(parts) == 2:
                                key_hint = parts[0].strip()
                                val_hint = parts[1].strip()
                                
                                key_type = self.infer_type(target.slice)
                                if not self.check_type_compatibility(key_hint, key_type):
                                    self.add_error(
                                        target.slice,
                                        severity='High',
                                        issue_type='RULE SET 8 — TYPE HINTS & ANNOTATIONS',
                                        explanation=f"Type Hint Violation: Expected key {key_hint}\nFound {key_type}",
                                        suggestion=f'# Verify dictionary key type hint'
                                    )
                                    
                                rhs_type = self.infer_type(node.value)
                                if not self.check_type_compatibility(val_hint, rhs_type):
                                    self.add_error(
                                        node.value,
                                        severity='High',
                                        issue_type='RULE SET 8 — TYPE HINTS & ANNOTATIONS',
                                        explanation=f"Type Hint Violation: Expected value {val_hint}\nFound {rhs_type}",
                                        suggestion=getattr(node.value, 'value', 'None')
                                    )
            elif isinstance(target, ast.Attribute):
                self.visit(target.value)
                if isinstance(target.value, ast.Name) and target.value.id == 'self':
                    curr = self.current_scope
                    while curr:
                        if curr.scope_type == 'class':
                            curr.symbols[target.attr] = {'name': target.attr, 'kind': 'variable', 'type_hint': inferred, 'node': target}
                            break
                        curr = curr.parent
            else:
                self.visit(target)

    def visit_AnnAssign(self, node):
        if node.value:
            self.visit(node.value)
            
        hint = self.parse_annotation(node.annotation)
        
        if isinstance(node.target, ast.Name):
            name = node.target.id
            curr = self.current_scope
            found_scope = None
            while curr:
                if name in curr.bound_names:
                    found_scope = curr
                    break
                curr = curr.parent
            if not found_scope:
                found_scope = self.global_scope
                
            found_scope.define(name, kind='variable', type_hint=hint, node=node.target)
            
            if node.value:
                found_scope.assigned_states[name] = 'ASSIGNED'
                val_type = self.infer_type(node.value)
                
                if not self.check_type_compatibility(hint, val_type):
                    if isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute) and node.value.func.attr == 'get':
                        self.add_error(
                            node.target,
                            severity='High',
                            issue_type='RULE SET 8 — TYPE HINTS & ANNOTATIONS',
                            explanation=f"Cannot assign {val_type} to {hint}",
                            suggestion=f"{name}: {val_type} = {self.lines[node.lineno - 1].split('=', 1)[1].strip()}"
                        )
                    else:
                        self.add_error(
                            node.value,
                            severity='High',
                            issue_type='RULE SET 8 — TYPE HINTS & ANNOTATIONS',
                            explanation=f"Type Hint Violation: Expected {hint}\nFound {val_type}",
                            suggestion=f"{getattr(node.value, 'value', '')}"
                        )
            else:
                found_scope.assigned_states[name] = 'UNASSIGNED'
        else:
            self.visit(node.target)

    def visit_Call(self, node):
        # 1. Non-with open() resource leaks check
        if isinstance(node.func, ast.Name) and node.func.id == 'open':
            if not self.inside_with_context:
                self.add_error(
                    node,
                    severity='Medium',
                    issue_type='RULE SET 10 — FILE HANDLING',
                    explanation="File opened without using a 'with' context manager (resource leak risk)",
                    suggestion="with open(...) as f:"
                )

        # 2. Check range wrong arguments
        if isinstance(node.func, ast.Name) and node.func.id == 'range':
            args = node.args
            if len(args) == 2:
                if isinstance(args[0], ast.Constant) and isinstance(args[1], ast.Constant):
                    start = args[0].value
                    stop = args[1].value
                    if isinstance(start, int) and isinstance(stop, int) and start > stop:
                        self.add_error(
                            node,
                            severity='Medium',
                            issue_type='RULE SET 2 — CONTROL FLOW',
                            explanation=f"range({start}, {stop}) produces an empty range",
                            suggestion=f"range({stop}, {start})"
                        )
            elif len(args) == 3:
                if isinstance(args[0], ast.Constant) and isinstance(args[1], ast.Constant) and isinstance(args[2], ast.Constant):
                    start = args[0].value
                    stop = args[1].value
                    step = args[2].value
                    if isinstance(start, int) and isinstance(stop, int) and isinstance(step, int):
                        if step == 0:
                            self.add_error(
                                node,
                                severity='Critical',
                                issue_type='RULE SET 2 — CONTROL FLOW',
                                explanation="range() step argument must not be zero",
                                suggestion="range(..., ..., 1)"
                            )
                        elif step > 0 and start > stop:
                            self.add_error(
                                node,
                                severity='Medium',
                                issue_type='RULE SET 2 — CONTROL FLOW',
                                explanation=f"range({start}, {stop}, {step}) produces an empty range",
                                suggestion=f"range({stop}, {start}, {step})"
                            )
                        elif step < 0 and start < stop:
                            self.add_error(
                                node,
                                severity='Medium',
                                issue_type='RULE SET 2 — CONTROL FLOW',
                                explanation=f"range({start}, {stop}, {step}) produces an empty range",
                                suggestion=f"range({stop}, {start}, {step})"
                            )

        if isinstance(node.func, ast.Attribute):
            self.visit(node.func.value)
            receiver_type = self.infer_type(node.func.value)
            method_name = node.func.attr
            
            if receiver_type and receiver_type.startswith(('list[', 'List[')) and method_name == 'append':
                inner = receiver_type.split('[', 1)[1].rsplit(']', 1)[0]
                elem_type = inner.strip()
                if node.args:
                    arg_node = node.args[0]
                    self.visit(arg_node)
                    arg_type = self.infer_type(arg_node)
                    if not self.check_type_compatibility(elem_type, arg_type):
                        self.add_error(
                            arg_node,
                            severity='High',
                            issue_type='RULE SET 8 — TYPE HINTS & ANNOTATIONS',
                            explanation=f"Type Hint Violation: {receiver_type} cannot accept {arg_type}",
                            suggestion=f'"{getattr(arg_node, "value", str(arg_node))}"'
                        )
                return
                
            if receiver_type and receiver_type in self.classes:
                cls_scope = self.classes[receiver_type]
                found = False
                search_scopes = [cls_scope]
                visited_classes = set()
                while search_scopes:
                    curr_cls = search_scopes.pop()
                    if curr_cls.name in visited_classes:
                        continue
                    visited_classes.add(curr_cls.name)
                    
                    if method_name in curr_cls.symbols:
                        found = True
                        break
                        
                    bases = curr_cls.symbols.get('__bases__', [])
                    for base in bases:
                        if base in self.classes:
                            search_scopes.append(self.classes[base])
                            
                if not found:
                    self.add_error(
                        node.func,
                        severity='Critical',
                        issue_type='RULE SET 5 — OOP',
                        explanation=f"{receiver_type} has no attribute '{method_name}'",
                        suggestion=f'# Verify attribute exists on class {receiver_type}'
                    )
            return

        if isinstance(node.func, ast.Name):
            func_name = node.func.id
            sym = self.current_scope.lookup(func_name)
            
            if not sym:
                self.add_error(
                    node.func,
                    severity='Critical',
                    issue_type='RULE SET 1 — PYTHON BASICS',
                    explanation=f"Name '{func_name}' is not defined",
                    suggestion=f'print'
                )
                for arg in node.args:
                    self.visit(arg)
                for kw in node.keywords:
                    self.visit(kw.value)
                return
                
            if sym['kind'] == 'function' and sym['node']:
                func_def = sym['node']
                self.validate_func_args(func_name, func_def, node)
                
        self.visit(node.func)
        for arg in node.args:
            self.visit(arg)
        for kw in node.keywords:
            self.visit(kw.value)

    def validate_func_args(self, func_name, func_def, node_call):
        args_def = func_def.args
        num_call_args = len(node_call.args)
        
        min_args = len(args_def.args) - len(args_def.defaults)
        # Exclude self or cls if method is not static and called normally
        # In this simple static analyzer, we assume arguments mapping directly
        
        has_vararg = args_def.vararg is not None
        max_args = float('inf') if has_vararg else len(args_def.args)
        
        if num_call_args < min_args:
            self.add_error(
                node_call,
                severity='Critical',
                issue_type='RULE SET 3 — FUNCTIONS',
                explanation=f"Function '{func_name}' expects at least {min_args} arguments, but {num_call_args} were given",
                suggestion=f"{func_name}({', '.join(['None']*min_args)})",
                symbol=func_name
            )
        elif num_call_args > max_args:
            self.add_error(
                node_call,
                severity='Critical',
                issue_type='RULE SET 3 — FUNCTIONS',
                explanation=f"Function '{func_name}' expects at most {len(args_def.args)} arguments, but {num_call_args} were given",
                suggestion=f"{func_name}({', '.join(['None']*len(args_def.args))})",
                symbol=func_name
            )

    def visit_Import(self, node):
        for name in node.names:
            module_name = name.name
            if not self.is_module_resolvable(module_name):
                self.add_error(
                    node,
                    severity='Critical',
                    issue_type='RULE SET 7 — MODULES & IMPORTS',
                    explanation=f"Import of non-existent / fake module: {module_name}",
                    suggestion=f"# Check if module {module_name} is installed"
                )
            self.current_scope.define(name.asname or module_name.split('.')[0], kind='import', node=node)
            self.current_scope.assigned_states[name.asname or module_name.split('.')[0]] = 'ASSIGNED'

    def visit_ImportFrom(self, node):
        module_name = node.module
        if module_name:
            if not self.is_module_resolvable(module_name):
                self.add_error(
                    node,
                    severity='Critical',
                    issue_type='RULE SET 7 — MODULES & IMPORTS',
                    explanation=f"Import of non-existent / fake module: {module_name}",
                    suggestion=f"# Check if module {module_name} is installed"
                )
            for name in node.names:
                if name.name == '*':
                    self.add_error(
                        node,
                        severity='Medium',
                        issue_type='RULE SET 7 — MODULES & IMPORTS',
                        explanation="from module import * pollutes the namespace and can cause shadowing errors.",
                        suggestion=f"# Import specific attributes instead of using *"
                    )
                self.current_scope.define(name.asname or name.name, kind='import', node=node)
                self.current_scope.assigned_states[name.asname or name.name] = 'ASSIGNED'

    def is_module_resolvable(self, name):
        std_libs = {
            'sys', 'os', 'math', 'json', 'ast', 'collections', 'datetime', 'random', 're', 
            'typing', 'time', 'functools', 'itertools', 'abc', 'importlib', 'urllib', 'weakref',
            'threading', 'multiprocessing', 'asyncio', 'unittest', 'pickle', 'subprocess', 'xml'
        }
        if name in std_libs or name.split('.')[0] in std_libs:
            return True
        try:
            spec = importlib.util.find_spec(name)
            return spec is not None
        except Exception:
            return False

    def visit_If(self, node):
        self.visit(node.test)
        
        is_falsy = False
        is_truthy = False
        if isinstance(node.test, ast.Constant):
            is_falsy = not bool(node.test.value)
            is_truthy = bool(node.test.value)
        elif isinstance(node.test, ast.Name) and node.test.id == 'False':
            is_falsy = True
        elif isinstance(node.test, ast.Name) and node.test.id == 'True':
            is_truthy = True

        if is_falsy or is_truthy:
            self.add_error(
                node.test,
                severity='Medium',
                issue_type='RULE SET 2 — CONTROL FLOW',
                explanation=f"Dead or unreachable branch: if {'True' if is_truthy else 'False'}: condition is constant.",
                suggestion="# Remove constant condition or dead branches"
            )

        initial_states = dict(self.current_scope.assigned_states)
        
        if is_falsy:
            prev_unreachable = self.unreachable
            self.unreachable = True
            for stmt in node.body:
                self.add_error(
                    stmt,
                    severity='Critical',
                    issue_type='RULE SET 2 — CONTROL FLOW',
                    explanation='Unreachable code detected inside dead branch',
                    suggestion='Remove dead branch'
                )
            self.unreachable = prev_unreachable
            
            if node.orelse:
                self.walk_block(node.orelse)
                
        elif is_truthy:
            self.walk_block(node.body)
            if node.orelse:
                prev_unreachable = self.unreachable
                self.unreachable = True
                for stmt in node.orelse:
                    self.add_error(
                        stmt,
                        severity='Critical',
                        issue_type='RULE SET 2 — CONTROL FLOW',
                        explanation='Unreachable code detected inside dead else branch',
                        suggestion='Remove dead else branch'
                    )
                self.unreachable = prev_unreachable
        else:
            then_states = dict(initial_states)
            self.current_scope.assigned_states = then_states
            self.walk_block(node.body)
            
            else_states = dict(initial_states)
            self.current_scope.assigned_states = else_states
            if node.orelse:
                self.walk_block(node.orelse)
                
            merged = {}
            all_keys = set(then_states.keys()).union(else_states.keys())
            for k in all_keys:
                s1 = then_states.get(k, 'UNASSIGNED')
                s2 = else_states.get(k, 'UNASSIGNED')
                if s1 == 'ASSIGNED' and s2 == 'ASSIGNED':
                    merged[k] = 'ASSIGNED'
                elif s1 in ('ASSIGNED', 'POSSIBLY_ASSIGNED') or s2 in ('ASSIGNED', 'POSSIBLY_ASSIGNED'):
                    merged[k] = 'POSSIBLY_ASSIGNED'
                else:
                    merged[k] = 'UNASSIGNED'
            self.current_scope.assigned_states = merged

    def visit_While(self, node):
        self.visit(node.test)
        
        is_infinite = False
        if isinstance(node.test, ast.Constant) and bool(node.test.value) is True:
            is_infinite = True
        elif isinstance(node.test, ast.Name) and node.test.id == 'True':
            is_infinite = True
            
        class TerminationChecker(ast.NodeVisitor):
            def __init__(self):
                self.has_exit = False
            def visit_Break(self, n): self.has_exit = True
            def visit_Return(self, n): self.has_exit = True
            def visit_Raise(self, n): self.has_exit = True
            
        checker = TerminationChecker()
        for stmt in node.body:
            checker.visit(stmt)
            
        self.walk_block(node.body)
        
        if is_infinite and not checker.has_exit:
            self.add_error(
                node,
                severity='High',
                issue_type='RULE SET 2 — CONTROL FLOW',
                explanation="while True: with no break or return creates an infinite loop.",
                suggestion="# Add a break condition or return statement"
            )
            self.unreachable = True

    def get_names_from_target(self, node):
        if isinstance(node, ast.Name):
            return [node.id]
        elif isinstance(node, (ast.Tuple, ast.List)):
            names = []
            for elt in node.elts:
                names.extend(self.get_names_from_target(elt))
            return names
        return []

    def visit_For(self, node):
        self.visit(node.iter)
        
        # Unused loop variable & shadowing checks
        loop_var_names = self.get_names_from_target(node.target)
        
        # Shadowing in nested loops check
        for name in loop_var_names:
            if any(name in outer for outer in self.active_loop_targets):
                self.add_error(
                    node.target,
                    severity='High',
                    issue_type='RULE SET 2 — CONTROL FLOW',
                    explanation=f"Nested loops with same variable name '{name}' (shadowing risk)",
                    suggestion=f"# Rename nested loop variable",
                    symbol=name
                )

        # Mark as loop variable for post-loop re-use warnings
        for name in loop_var_names:
            self.current_scope.define(name, kind='variable', node=node.target)
            self.current_scope.assigned_states[name] = 'ASSIGNED'
            sym = self.current_scope.symbols.get(name)
            if sym:
                sym['is_loop_var'] = True

        self.active_loop_targets.append(loop_var_names)
        self.walk_block(node.body)
        self.active_loop_targets.pop()
        
        # Check unused loop variables
        for name in loop_var_names:
            sym = self.current_scope.symbols.get(name)
            if sym and not sym.get('used', False) and not name.startswith('_'):
                self.add_error(
                    node.target,
                    severity='Medium',
                    issue_type='RULE SET 2 — CONTROL FLOW',
                    explanation=f"For loop variable '{name}' is unused inside body",
                    suggestion=f"Use '_' as loop variable if it is not used: for _ in range(...):",
                    symbol=name
                )
        
        # After loop ends, they become POSSIBLY_ASSIGNED
        for name in loop_var_names:
            if self.current_scope.assigned_states.get(name) != 'ASSIGNED':
                self.current_scope.assigned_states[name] = 'POSSIBLY_ASSIGNED'

    def visit_Try(self, node):
        for handler in node.handlers:
            if handler.type is None:
                self.add_error(
                    handler,
                    severity='High',
                    issue_type='RULE SET 9 — EXCEPTION HANDLING',
                    explanation="Bare except: clause catches all exceptions, suppressing crashes but masking severe errors. Use except Exception:",
                    suggestion="except Exception:"
                )
            else:
                if isinstance(handler.type, ast.Name) and handler.type.id in ('Exception', 'BaseException'):
                    self.add_error(
                        handler.type,
                        severity='Medium',
                        issue_type='RULE SET 9 — EXCEPTION HANDLING',
                        explanation=f"Catching Exception too broadly: '{handler.type.id}'",
                        suggestion=f"# Catch specific exception types (e.g. ValueError, KeyError)"
                    )
            
            # Check empty except block
            is_empty = False
            if len(handler.body) == 1:
                stmt = handler.body[0]
                if isinstance(stmt, ast.Pass):
                    is_empty = True
                elif isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str):
                    is_empty = True
            if is_empty:
                self.add_error(
                    handler,
                    severity='High',
                    issue_type='RULE SET 9 — EXCEPTION HANDLING',
                    explanation="Empty except block silently swallows exceptions. This makes debugging impossible.",
                    suggestion="# Log the exception or add handling logic"
                )
                
            self.walk_block(handler.body)
            
        if node.finalbody:
            class ReturnFinder(ast.NodeVisitor):
                def __init__(self):
                    self.returns = []
                def visit_Return(self, n): self.returns.append(n)
            finder = ReturnFinder()
            for stmt in node.finalbody:
                finder.visit(stmt)
            for ret in finder.returns:
                self.add_error(
                    ret,
                    severity='Medium',
                    issue_type='RULE SET 9 — EXCEPTION HANDLING',
                    explanation="finally block contains a return statement. This overrides try/except return statements.",
                    suggestion="# Move return statement out of finally block"
                )
            self.walk_block(node.finalbody)
            
        self.walk_block(node.body)
        if node.orelse:
            self.walk_block(node.orelse)

    def visit_Compare(self, node):
        # 1. Comparison of None using == instead of is
        is_none_comparison = False
        for op in node.ops:
            if isinstance(op, (ast.Eq, ast.NotEq)):
                if isinstance(node.left, ast.Constant) and node.left.value is None:
                    is_none_comparison = True
                for comp in node.comparators:
                    if isinstance(comp, ast.Constant) and comp.value is None:
                        is_none_comparison = True
                        
        if is_none_comparison:
            self.add_error(
                node,
                severity='Medium',
                issue_type='RULE SET 22 — PYTHONIC CODE & BEST PRACTICES',
                explanation="Comparing None with == or != is not pythonic. Use 'is None' or 'is not None'.",
                suggestion="x is None"
            )
            
        # 2. Check if empty list using len(x) == 0
        is_len_zero = False
        if len(node.ops) == 1 and isinstance(node.ops[0], (ast.Eq, ast.NotEq)):
            left = node.left
            right = node.comparators[0]
            if isinstance(left, ast.Call) and isinstance(left.func, ast.Name) and left.func.id == 'len':
                if isinstance(right, ast.Constant) and right.value == 0:
                    is_len_zero = True
            elif isinstance(right, ast.Call) and isinstance(right.func, ast.Name) and right.func.id == 'len':
                if isinstance(left, ast.Constant) and left.value == 0:
                    is_len_zero = True
                    
        if is_len_zero:
            self.add_error(
                node,
                severity='Medium',
                issue_type='RULE SET 22 — PYTHONIC CODE & BEST PRACTICES',
                explanation="Checking if list is empty with len(x) == 0 is not pythonic. Use 'not x'.",
                suggestion="not x"
            )
            
        self.visit(node.left)
        for comp in node.comparators:
            self.visit(comp)

    def visit_With(self, node):
        old_with = self.inside_with_context
        for item in node.items:
            self.inside_with_context = True
            self.visit(item.context_expr)
            self.inside_with_context = False
            if item.optional_vars:
                self.visit(item.optional_vars)
        self.walk_block(node.body)
        self.inside_with_context = old_with

    def check_unused_symbols(self, scope):
        for name, sym in scope.symbols.items():
            if name.startswith('_') or name in ('self', 'cls', 'args', 'kwargs'):
                continue
            if sym['kind'] == 'builtin':
                continue
                
            if not sym.get('used', False):
                node = sym['node']
                if not node:
                    continue
                    
                if sym['kind'] == 'variable':
                    self.add_error(
                        node,
                        severity='Low',
                        issue_type='RULE SET 1 — PYTHON BASICS',
                        explanation=f"Variable '{name}' declared but never used",
                        suggestion=f"# Remove unused variable '{name}'",
                        symbol=name
                    )
                elif sym['kind'] == 'import':
                    self.add_error(
                        node,
                        severity='Low',
                        issue_type='RULE SET 7 — MODULES & IMPORTS',
                        explanation=f"Unused import: '{name}'",
                        suggestion=f"# Remove unused import '{name}'",
                        symbol=name
                    )
                elif sym['kind'] == 'function':
                    if name != 'main' and not name.startswith('test_'):
                        self.add_error(
                            node,
                            severity='Low',
                            issue_type='RULE SET 3 — FUNCTIONS',
                            explanation=f"Function '{name}' defined but never called",
                            suggestion=f"# Remove function '{name}' or invoke it",
                            symbol=name
                        )

    def get_priority(self, issue):
        sev = issue['severity']
        if sev == 'Critical':
            return 3
        if sev == 'High':
            return 2
        if sev == 'Medium':
            return 1
        return 0

    def finalize(self):
        # 1. Check unused symbols recursively
        def check_unused(scope):
            self.check_unused_symbols(scope)
            for child in scope.children:
                check_unused(child)
        check_unused(self.global_scope)
        
        # 2. Line-level cascade suppression (shield)
        highest_p = {}
        for err in self.errors:
            p = self.get_priority(err)
            line = err['line']
            if line not in highest_p or p > highest_p[line]:
                highest_p[line] = p
                
        suppressed_issues = []
        for err in self.errors:
            p = self.get_priority(err)
            line = err['line']
            if p == highest_p[line]:
                suppressed_issues.append(err)
                
        # 3. Categorized scoring & grouping
        grouped_issues = {
            'rootCauseErrors': {},
            'errors': {},
            'warnings': {},
            'info': {}
        }
        
        total_errors = 0
        total_warnings = 0
        total_info = 0
        
        for issue in suppressed_issues:
            comp = issue['component']
            cat = issue.get('category', 'INFO')
            
            if cat == 'ERROR':
                total_errors += 1
                if comp not in grouped_issues['rootCauseErrors']:
                    grouped_issues['rootCauseErrors'][comp] = []
                grouped_issues['rootCauseErrors'][comp].push(issue) if hasattr(grouped_issues['rootCauseErrors'][comp], 'push') else grouped_issues['rootCauseErrors'][comp].append(issue)
                
                if comp not in grouped_issues['errors']:
                    grouped_issues['errors'][comp] = []
                grouped_issues['errors'][comp].append(issue)
            elif cat == 'WARNING':
                total_warnings += 1
                if comp not in grouped_issues['warnings']:
                    grouped_issues['warnings'][comp] = []
                grouped_issues['warnings'][comp].append(issue)
            else:
                total_info += 1
                if comp not in grouped_issues['info']:
                    grouped_issues['info'][comp] = []
                grouped_issues['info'][comp].append(issue)
                
        score = 100 - (total_errors * 10) - (total_warnings * 4) - (total_info * 1)
        score = max(0, min(100, score))
        
        if score >= 90:
            quality = 'Excellent'
        elif score >= 70:
            quality = 'Good'
        elif score >= 40:
            quality = 'Risky'
        else:
            quality = 'Poor'
            
        return {
            'valid': total_errors == 0,
            'errors': suppressed_issues,
            'groupedIssues': grouped_issues,
            'improvedCode': self.code,
            'fixedCode': self.code,
            'suggestions': [],
            'blockedFixes': [],
            'summary': {
                'totalErrors': total_errors,
                'totalWarnings': total_warnings,
                'totalInfo': total_info,
                'finalScore': score,
                'codeQuality': quality
            }
        }

def main():
    try:
        code = sys.stdin.read()
    except Exception as e:
        print(json.dumps({
            'valid': False,
            'errors': [{
                'line': 1, 'column': 1, 'severity': 'Critical', 'category': 'ERROR', 'issueType': 'Syntax Error',
                'explanation': f"Could not read source code input: {str(e)}", 'suggestion': ''
            }]
        }))
        return

    # 1. Parse Python AST
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        clean_msg = str(e)
        issue_type = 'Syntax Error'
        if 'IndentationError' in clean_msg or 'unexpected indent' in clean_msg or 'expected an indented block' in clean_msg:
            issue_type = 'Indentation Problem'
            
        print(json.dumps({
            'valid': False,
            'errors': [{
                'line': e.lineno or 1,
                'column': e.offset or 1,
                'severity': 'Critical',
                'category': 'ERROR',
                'issueType': issue_type,
                'explanation': f"{e.msg} (Syntax Error during parse)" if hasattr(e, 'msg') else str(e),
                'suggestion': 'Verify colons, indentation level, and valid Python syntax.'
            }],
            'groupedIssues': {
                'rootCauseErrors': {
                    'Global': [{
                        'line': e.lineno or 1, 'column': e.offset or 1, 'severity': 'Critical', 'category': 'ERROR',
                        'issueType': issue_type, 'explanation': f"{e.msg} (Syntax Error during parse)" if hasattr(e, 'msg') else str(e),
                        'suggestion': 'Verify colons, indentation level, and valid Python syntax.'
                    }]
                },
                'errors': {}, 'warnings': {}, 'info': {}
            },
            'summary': {
                'totalErrors': 1, 'totalWarnings': 0, 'totalInfo': 0, 'finalScore': 90, 'codeQuality': 'Good'
            }
        }))
        return

    # 2. Walk AST to detect Semantic/Type errors
    try:
        analyzer = PythonStaticAnalyzer(code)
        analyzer.visit(tree)
        result = analyzer.finalize()
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({
            'valid': False,
            'errors': [{
                'line': 1, 'column': 1, 'severity': 'Critical', 'category': 'ERROR', 'issueType': 'Syntax Error',
                'explanation': f"Internal analysis engine failure: {str(e)}", 'suggestion': ''
            }],
            'groupedIssues': {
                'rootCauseErrors': {
                    'Global': [{
                        'line': 1, 'column': 1, 'severity': 'Critical', 'category': 'ERROR', 'issueType': 'Syntax Error',
                        'explanation': f"Internal analysis engine failure: {str(e)}", 'suggestion': ''
                    }]
                },
                'errors': {}, 'warnings': {}, 'info': {}
            },
            'summary': {
                'totalErrors': 1, 'totalWarnings': 0, 'totalInfo': 0, 'finalScore': 90, 'codeQuality': 'Good'
            }
        }))

if __name__ == '__main__':
    main()
