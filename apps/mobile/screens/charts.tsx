// Petits graphiques pour les écrans de stats (courbe + barres), basés sur react-native-svg.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Polyline } from "react-native-svg";
import { colors, radius, space, type } from "../theme";

export interface Point {
  label: string;
  value: number;
}

// Courbe (aire + ligne) : évolution d'une valeur dans le temps.
export function LineChart({ data, height = 170, color = colors.primary }: { data: Point[]; height?: number; color?: string }) {
  const [w, setW] = useState(0);
  const padX = 10;
  const padTop = 12;
  const padBottom = 22;
  const innerW = Math.max(0, w - padX * 2);
  const innerH = height - padTop - padBottom;
  const max = Math.max(1, ...data.map((d) => d.value));

  const pts = data.map((d, i) => {
    const x = padX + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = padTop + innerH - (d.value / max) * innerH;
    return { x, y };
  });
  const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area =
    pts.length > 0
      ? `M ${pts[0].x},${padTop + innerH} ` + pts.map((p) => `L ${p.x},${p.y}`).join(" ") + ` L ${pts[pts.length - 1].x},${padTop + innerH} Z`
      : "";

  // Étiquettes d'axe : premier, milieu, dernier.
  const labelIdx = data.length > 2 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : data.map((_, i) => i);

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && data.length > 0 && (
        <Svg width={w} height={height}>
          <Line x1={padX} y1={padTop + innerH} x2={padX + innerW} y2={padTop + innerH} stroke={colors.border} strokeWidth={1} />
          {area ? <Path d={area} fill={colors.surfaceAlt} /> : null}
          {pts.length > 1 ? <Polyline points={poly} fill="none" stroke={color} strokeWidth={2.5} /> : null}
          {pts.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={pts.length > 24 ? 1.5 : 3} fill={color} />
          ))}
        </Svg>
      )}
      <View style={s.axis}>
        {labelIdx.map((i) => (
          <Text key={i} style={s.axisLabel}>{data[i]?.label ?? ""}</Text>
        ))}
      </View>
    </View>
  );
}

// Barres horizontales (ex. CA par service).
export function BarList({ data, color = colors.primary, format }: { data: Point[]; color?: string; format: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ gap: space.sm }}>
      {data.map((d) => (
        <View key={d.label} style={s.barRow}>
          <View style={s.barHead}>
            <Text style={s.barLabel}>{d.label}</Text>
            <Text style={s.barVal}>{format(d.value)}</Text>
          </View>
          <View style={s.barTrack}>
            <View style={[s.barFill, { width: `${Math.max(2, (d.value / max) * 100)}%`, backgroundColor: color }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

// Barre empilée (ex. mix Espèces / CB / Autre).
export function StackBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <View style={{ gap: space.xs }}>
      <View style={s.stack}>
        {segments.map((seg) => (
          <View key={seg.label} style={{ width: `${(seg.value / total) * 100}%`, backgroundColor: seg.color }} />
        ))}
      </View>
      <View style={s.legendRow}>
        {segments.map((seg) => (
          <View key={seg.label} style={s.legendItem}>
            <View style={[s.dot, { backgroundColor: seg.color }]} />
            <Text style={s.legendText}>{seg.label} {Math.round((seg.value / total) * 100)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  axisLabel: { ...type.small, color: colors.textMuted, fontSize: 11 },
  barRow: { gap: 4 },
  barHead: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  barLabel: { ...type.small, color: colors.text, flex: 1 },
  barVal: { ...type.small, color: colors.textMuted },
  barTrack: { height: 10, borderRadius: radius.pill, backgroundColor: colors.chipBg, overflow: "hidden" },
  barFill: { height: 10, borderRadius: radius.pill },
  stack: { flexDirection: "row", height: 16, borderRadius: radius.pill, overflow: "hidden", backgroundColor: colors.chipBg },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { ...type.small, color: colors.textMuted },
});
