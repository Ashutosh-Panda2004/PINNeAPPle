"""PyVista bridge: CalculiX results to grids (checked against beam theory), twin3d scenes, rendering."""
import os

import numpy as np
import pytest

pv = pytest.importorskip("pyvista")

from pinneapple_simulation.external_solvers.calculix import cantilever_hex_mesh, read_frd, write_frd
from pinneapple_tools.visualization.pyvista_bridge import (
    calculix_grid, can_render, export_vtk, grid_from_arrays, render_png, scene_to_multiblock, von_mises,
)

L, B, H, E, P = 1.0, 0.1, 0.1, 210e9, 1000.0


def _beam_results(tmp_path, element_type):
    m = cantilever_hex_mesh(L, B, H, nx=10, ny=2, nz=2, element_type=element_type)
    ids, xyz = m.node_array()
    x = xyz[:, 0]
    inertia = B * H ** 3 / 12
    w = P * x ** 2 * (3 * L - x) / (6 * E * inertia)
    stress = np.zeros((len(ids), 6))
    stress[:, 0] = P * (L - x) * (xyz[:, 2] - H / 2) / inertia  # sigma_xx = M z / I
    path = write_frd(str(tmp_path / "beam.frd"), ids, xyz, m.elements, element_type,
                     {"DISP": np.stack([0 * x, 0 * x, -w], 1), "STRESS": stress})
    return m, read_frd(path)


@pytest.mark.parametrize("element_type", ["C3D8", "C3D20R"])
def test_calculix_grid_geometry_and_fields_match_beam_theory(tmp_path, element_type):
    m, frd = _beam_results(tmp_path, element_type)
    grid = calculix_grid(m, frd)
    # a wrong VTK node order for the 20-node brick would not integrate to the box volume
    assert grid.volume == pytest.approx(L * B * H, rel=1e-9)
    assert grid.n_cells == len(m.elements) and {"DISP", "|U|", "STRESS", "VON_MISES"} <= set(grid.point_data)
    # the .frd format stores 12-character fields (about 6 significant digits), hence rel=1e-5
    assert grid["VON_MISES"].max() == pytest.approx(6 * P * L / (B * H ** 2), rel=1e-5)  # 6 MPa at the root
    assert grid["|U|"].max() == pytest.approx(P * L ** 3 / (3 * E * (B * H ** 3 / 12)), rel=1e-5)  # PL^3/3EI


def test_warp_moves_points_by_scale_times_displacement(tmp_path):
    m, frd = _beam_results(tmp_path, "C3D8")
    plain, warped = calculix_grid(m, frd), calculix_grid(m, frd, warp=10.0)
    assert np.allclose(warped.points - plain.points, 10.0 * plain["DISP"])
    with pytest.raises(ValueError, match="warp needs displacements"):
        calculix_grid(m, warp=5.0)


def test_von_mises_known_states_and_validation():
    assert von_mises(np.array([[100.0, 0, 0, 0, 0, 0]]))[0] == pytest.approx(100.0)       # uniaxial
    assert von_mises(np.array([[0, 0, 0, 50.0, 0, 0]]))[0] == pytest.approx(50 * 3 ** 0.5)  # pure shear
    assert von_mises(np.array([[80.0, 80.0, 80.0, 0, 0, 0]]))[0] == pytest.approx(0.0)      # hydrostatic
    with pytest.raises(ValueError):
        von_mises(np.zeros((3, 5)))


def test_grid_from_arrays_rejects_bad_input():
    pts = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1.0]])
    assert grid_from_arrays(pts, [[0, 1, 2, 3]], 10).volume == pytest.approx(1 / 6)
    with pytest.raises(ValueError, match="out of range"):
        grid_from_arrays(pts, [[0, 1, 2, 9]], 10)
    with pytest.raises(ValueError, match="values for"):
        grid_from_arrays(pts, [[0, 1, 2, 3]], 10, {"f": np.zeros(3)})


def test_scene_to_multiblock_slices_the_requested_time_step():
    from pinneapple_twin3d import Scene
    s = Scene("t", times=[0.0, 1.0])
    s.add_part("plate", [[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]])
    s.parts[0].fields["T"] = np.array([[1.0, 2.0, 3.0], [10.0, 20.0, 30.0]])
    mb = scene_to_multiblock(s, time_index=1)
    assert list(mb.keys()) == ["plate"] and mb["plate"]["T"].tolist() == [10.0, 20.0, 30.0]


def test_export_vtk_round_trip(tmp_path):
    pts = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1.0]])
    g = grid_from_arrays(pts, [[0, 1, 2, 3]], 10, {"f": np.arange(4.0)})
    path = export_vtk(g, str(tmp_path / "g.vtu"))
    assert pv.read(path)["f"].tolist() == [0.0, 1.0, 2.0, 3.0]


def test_render_png_writes_an_image_or_explains_how_to_get_a_gl_context(tmp_path):
    grid = grid_from_arrays(np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1.0]]), [[0, 1, 2, 3]], 10,
                            {"f": np.arange(4.0)})
    out = str(tmp_path / "g.png")
    if can_render():
        render_png(grid, out, scalars="f", window_size=(320, 240))
        assert os.path.getsize(out) > 1000
    else:
        with pytest.raises(RuntimeError, match="xvfb-run"):
            render_png(grid, out, scalars="f")
