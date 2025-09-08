export function invertRecord(record) {
  const inverted = {};
  for (const [k, v] of Object.entries(record || {})) {
    if (v != null) inverted[String(v)] = String(k);
  }
  return inverted;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
