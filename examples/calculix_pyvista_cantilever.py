"""CalculiX cantilever -> PyVista image: von Mises stress on the deformed beam.

Needs ``pip install "pinneapple[pyvista]"``. On a headless server run it as ``xvfb-run -a python <this file>``.
Runs without CalculiX: the displacement and stress fields come from beam theory and are written as a real
``.frd``, the same file ``ccx`` would produce, so the PyVista step is identical for a real run (use
``run_ccx`` from ``pinneapple_simulation.external_solvers.calculix`` to get one).
"""
import os
import tempfile

import numpy as np

from pinneapple_simulation.external_solvers.calculix import cantilever_hex_mesh, read_frd, write_frd
from pinneapple_tools.visualization import calculix_grid, can_render, export_vtk, render_png

L, B, H, E, P = 1.0, 0.1, 0.1, 210e9, 1000.0

model = cantilever_hex_mesh(L, B, H, nx=20, ny=3, nz=3, element_type="C3D8")
ids, xyz = model.node_array()
x, z = xyz[:, 0], xyz[:, 2]
inertia = B * H ** 3 / 12
deflection = P * x ** 2 * (3 * L - x) / (6 * E * inertia)
stress = np.zeros((len(ids), 6))
stress[:, 0] = P * (L - x) * (z - H / 2) / inertia

out = tempfile.mkdtemp()
frd = read_frd(write_frd(os.path.join(out, "beam.frd"), ids, xyz, model.elements, "C3D8",
                         {"DISP": np.stack([0 * x, 0 * x, -deflection], 1), "STRESS": stress}))

grid = calculix_grid(model, frd, warp=40.0)  # deformation exaggerated 40x: say so in the caption
print("VTK file for ParaView:", export_vtk(grid, os.path.join(out, "beam.vtu")))
if can_render():
    png = render_png(grid, os.path.join(out, "beam.png"), scalars="VON_MISES", show_edges=True,
                     title="Cantilever, von Mises stress (deformation x40)", scalar_bar_title="von Mises [Pa]")
    print("image:", png)
else:
    print("No OpenGL context here; run under `xvfb-run -a` to render the PNG.")
