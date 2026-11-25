"""Generate the synthetic DXF fixtures used by tests/e2e (no customer data)."""
import math
from pathlib import Path
HERE = Path(__file__).resolve().parent
K = math.tan(math.pi / 8)  # bulge of a 90° arc

def lw(layer, pts, closed=False):
    out = ['0', 'LWPOLYLINE', '8', layer, '90', str(len(pts)), '70', '1' if closed else '0']
    for p in pts:
        out += ['10', repr(float(p[0])), '20', repr(float(p[1]))]
        if len(p) > 2 and p[2]:
            out += ['42', repr(float(p[2]))]
    return out

def line(layer, a, b):
    return ['0', 'LINE', '8', layer, '10', repr(float(a[0])), '20', repr(float(a[1])), '30', '0', '11', repr(float(b[0])), '21', repr(float(b[1])), '31', '0']

def dxf(insunits, layers, entities):
    out = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015', '9', '$INSUNITS', '70', str(insunits), '0', 'ENDSEC',
           '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', str(len(layers))]
    for name, color in layers:
        out += ['0', 'LAYER', '2', name, '70', '0', '62', str(color), '6', 'Continuous']
    out += ['0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES']
    for e in entities:
        out += e
    return '\n'.join(out + ['0', 'ENDSEC', '0', 'EOF']) + '\n'

(HERE / 'arc-check.dxf').write_text(dxf(4, [('0', 7), ('FRAME', 3), ('NEG', 1), ('POS', 2), ('FILLET', 6)], [
    lw('FRAME', [(0, 0), (60, 0), (60, 40), (0, 40)], True),
    lw('NEG', [(15, 10, -K), (10, 15)]),        # centre (15,15) r=5
    lw('NEG', [(20, 25, -0.5), (24, 25)]),      # centre (22,23.5) r=2.5 apex (22,26)
    lw('POS', [(35, 10, K), (30, 15)]),         # centre (30,10) r=5
    lw('FILLET', [(42, 12), (42, 28, -K), (44, 30), (54, 30, -K), (56, 28), (56, 12, -K), (54, 10), (44, 10, -K)], True),  # clockwise, r=2 fillets
    line('0', (5, 34), (15, 34)),               # 10 mm baseline
    lw('0', [(5, 20), (9, 24), (9, 20), (5, 24)], True),  # self-intersecting: area must not be reported
]))
(HERE / 'no-unit.dxf').write_text(dxf(0, [('0', 7), ('FRAME', 3)], [
    lw('FRAME', [(0, 0), (60, 0), (60, 40), (0, 40)], True),
    line('0', (5, 34), (15, 34)),
]))
