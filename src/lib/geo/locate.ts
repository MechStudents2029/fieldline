/** Fill the punch form from the device. A denial leaves the fields blank and the punch still saves. */

export function fillLocation(form: HTMLFormElement): Promise<void> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        write(form, "lat", position.coords.latitude);
        write(form, "lng", position.coords.longitude);
        write(form, "accuracy", position.coords.accuracy);
        resolve();
      },
      () => resolve(),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 4000 },
    );
  });
}

function write(form: HTMLFormElement, name: string, value: number) {
  const input = form.elements.namedItem(name);
  if (input instanceof HTMLInputElement && Number.isFinite(value)) input.value = String(value);
}
