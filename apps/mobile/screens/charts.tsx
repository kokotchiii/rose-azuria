// Petits graphiques pour les écrans de stats (courbe + barres + anneau), basés sur react-native-svg.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Polyline, Stop } from "react-native-svg";
import { colors, radius, space, type } from "../theme";

export interface Point {
  label: string;
  value: number;
}

// Courbe (aire dégradée + ligne) : évolution d'une valeur dans le temps.
export function LineChart({
  data,
  height = 180,
  color = colors.primary,
  format,
}: {
  data: Point[];
  height?: number;
  color?: string;
  format?: (v: number) => string;
}) {
  const [w, setW] = useState(0);
  const padX = 12;
  const padTop = 18;
  const padBottom = 22;
  const innerW = Math.max(0, w - padX * 2);
  const innerH = height - padTop - padBottom;
  const max = Math.max(1, ...data.map((d) => d.value));

  const pts = data.map((d, i) => {
    const x = padX + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = padTop + innerH - (d.value / max) * innerH;
    return { x, y, value: d.value };
  });
  const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area =
    pts.length > 0
      ? `M ${pts[0].x},${padTop + innerH} ` + pts.map((p) => `L ${p.x},${p.y}`).join(" ") + ` L ${pts[pts.length - 1].x},${padTop + innerH} Z`
      : "";

  // Étiquettes d'axe : premier, milieu, dernier.
  const labelIdx = data.length > 2 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : data.map((_, i) => i);
  // Point culminant (mis en valeur).
  const peakIdx = pts.reduce((best, p, i) => (p.value > pts[best].value ? i : best), 0);

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && data.length > 0 && (
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id="lineArea" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.22} />
              <Stop offset="1" stopColor={color} stopOpacity={0.02} />
            </LinearGradient>
          </Defs>
          {/* lignes de repère */}
          {[0, 0.5, 1].map((f) => (
            <Line key={f} x1={padX} y1={padTop + innerH * f} x2={padX + innerW} y2={padTop + innerH * f} stroke={colors.border} strokeWidth={1} strokeDasharray={f === 1 ? undefined : "3 4"} />
          ))}
          {area ? <Path d={area} fill="url(#lineArea)" /> : null}
          {pts.length > 1 ? <Polyline points={poly} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" /> : null}
          {pts.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={pts.length > 24 ? 1.5 : i === peakIdx ? 4 : 3} fill={i === peakIdx ? color : colors.surface} stroke={color} strokeWidth={i === peakIdx ? 0 : 1.5} />
          ))}
        </Svg>
      )}
      <View style={s.axis}>
        {labelIdx.map((i) => (
          <Text key={i} style={s.axisLabel}>{data[i]?.label ?? ""}</Text>
        ))}
      </View>
      {format && pts.length > 0 ? (
        <Text style={s.peak}>Pic : {format(pts[peakIdx].value)} ({data[peakIdx]?.label})</Text>
      ) : null}
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
            <Text style={s.barLabel} numberOfLines={1}>{d.label}</Text>
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

// Anneau (donut) : répartition d'un total en parts colorées, libellé au centre.
export function Donut({
  segments,
  size = 150,
  thickness = 24,
  centerValue,
  centerLabel,
  format,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerValue?: string;
  centerLabel?: string;
  format: (v: number) => string;
}) {
  const total = segments.reduce((sum, x) => sum + x.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments
    .filter((seg) => seg.value > 0)
    .map((seg, i) => {
      const dash = (seg.value / (total || 1)) * circ;
      const el = (
        <Circle
          key={i}
          cx={cx}
          cy={cy}
          r={r}
          stroke={seg.color}
          strokeWidth={thickness}
          fill="none"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeDashoffset={-offset}
        />
      );
      offset += dash;
      return el;
    });

  return (
    <View style={s.donutRow}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${cx}, ${cy}`}>
            {total === 0 ? (
              <Circle cx={cx} cy={cy} r={r} stroke={colors.chipBg} strokeWidth={thickness} fill="none" />
            ) : (
              arcs
            )}
          </G>
        </Svg>
        <View style={[s.donutCenter, { width: size, height: size }]} pointerEvents="none">
          {centerValue ? <Text style={s.donutValue}>{centerValue}</Text> : null}
          {centerLabel ? <Text style={s.donutLabel}>{centerLabel}</Text> : null}
        </View>
      </View>
      <View style={s.donutLegend}>
        {segments.filter((seg) => seg.value > 0).map((seg) => (
          <View key={seg.label} style={s.legendItem}>
            <View style={[s.dot, { backgroundColor: seg.color }]} />
            <Text style={s.legendText} numberOfLines={1}>
              {seg.label} · {format(seg.value)} ({Math.round((seg.value / (total || 1)) * 100)}%)
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  axisLabel: { ...type.small, color: colors.textMuted, fontSize: 11 },
  peak: { ...type.small, color: colors.textMuted, marginTop: 4, fontSize: 12 },
  barRow: { gap: 4 },
  barHead: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  barLabel: { ...type.small, color: colors.text, flex: 1 },
  barVal: { ...type.small, color: colors.textMuted },
  barTrack: { height: 10, borderRadius: radius.pill, backgroundColor: colors.chipBg, overflow: "hidden" },
  barFill: { height: 10, borderRadius: radius.pill },
  stack: { flexDirection: "row", height: 16, borderRadius: radius.pill, overflow: "hidden", backgroundColor: colors.chipBg },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { ...type.small, color: colors.textMuted, flexShrink: 1 },
  donutRow: { flexDirection: "row", alignItems: "center", gap: space.lg },
  donutCenter: { position: "absolute", top: 0, left: 0, alignItems: "center", justifyContent: "center" },
  donutValue: { ...type.h2, color: colors.text, fontSize: 18 },
  donutLabel: { ...type.small, color: colors.textMuted, fontSize: 11 },
  donutLegend: { flex: 1, gap: space.sm },
});
