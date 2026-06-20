# PathKittyTemporary
Temporary GUI for Pkitty that generates the json files that we will use in the path planning library

## Bezier curve export

When the path mode is Bezier, the exported JSON includes a `bezier_curve` object. Each entry in
`bezier_curve.segments` describes one cubic segment for a local parameter `t` from `0` to `1`.
Coordinates and coefficients are in meters.

Evaluate either axis with:

```text
position(t) = cubic * t^3 + quadratic * t^2 + linear * t + constant
```

For example, robot code can evaluate a segment without parsing the human-readable `equations`
field:

```java
static double evaluate(Coefficients c, double t) {
  return ((c.cubic * t + c.quadratic) * t + c.linear) * t + c.constant;
}
```

Use the `x` coefficients for field X and the `y` coefficients for field Y. The equation defines
the exact path geometry; a trajectory parameterization and closed-loop controller are still needed
to choose `t` over time while respecting velocity and acceleration constraints.
