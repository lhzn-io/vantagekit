# Python API

The public names of each module are exported from the module itself:
`from vantagekit.core import UpFrame` and `from vantagekit.kit import ViewerControls`.

## vantagekit.core

```{eval-rst}
.. automodule:: vantagekit.core
```

### Stage frames

```{eval-rst}
.. autoclass:: vantagekit.core.UpFrame
   :members:
   :undoc-members:
```

### Camera math

```{eval-rst}
.. autofunction:: vantagekit.core.orbit_eye
.. autofunction:: vantagekit.core.orbit_from_eye
.. autofunction:: vantagekit.core.chase_view
.. autofunction:: vantagekit.core.pov_view
.. autofunction:: vantagekit.core.look_at_matrix
```

### Smoothing

```{eval-rst}
.. autoclass:: vantagekit.core.Smoothed3
   :members:
   :undoc-members:

.. autoclass:: vantagekit.core.SmoothedAngle
   :members:
   :undoc-members:

.. autofunction:: vantagekit.core.exp_alpha
.. autofunction:: vantagekit.core.spring_step
.. autofunction:: vantagekit.core.wrap_angle
```

### Bindings

```{eval-rst}
.. autoclass:: vantagekit.core.Binding
   :members:
   :undoc-members:

.. autoclass:: vantagekit.core.BindingState
   :members:
   :undoc-members:

.. autoclass:: vantagekit.core.Frame
   :members:
   :undoc-members:

.. autodata:: vantagekit.core.DEFAULT_BINDINGS
   :no-value:
```

### Targets

```{eval-rst}
.. autoclass:: vantagekit.core.Pose
   :members:
   :undoc-members:

.. autoclass:: vantagekit.core.TargetProvider
   :members:
   :undoc-members:

.. autoclass:: vantagekit.core.CallbackTargets
   :members:
   :undoc-members:

.. autoclass:: vantagekit.core.TargetCycler
   :members:
   :undoc-members:
```

## vantagekit.kit

These adapters import `carb`, `omni` and `pxr`, which exist only inside Omniverse Kit; the
documentation is built without Kit.

```{eval-rst}
.. automodule:: vantagekit.kit

.. autoclass:: vantagekit.kit.ViewerControls
   :members:
   :undoc-members:

.. autoclass:: vantagekit.kit.CameraRig
   :members:
   :undoc-members:

.. autoclass:: vantagekit.kit.RigSettings
   :members:
   :undoc-members:

.. autodata:: vantagekit.kit.MODES

.. autoclass:: vantagekit.kit.InputRouter
   :members:
   :undoc-members:

.. autoclass:: vantagekit.kit.NativeNavigation
   :members:
   :undoc-members:

.. autofunction:: vantagekit.kit.on_update
.. autofunction:: vantagekit.kit.on_stage_opened
```
