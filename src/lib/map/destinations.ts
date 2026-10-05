export type DestinationKind = "city" | "volcano" | "lake" | "coast" | "heritage";

export type Destination = {
  id: string;
  name: string;
  region: string;
  kind: DestinationKind;
  coordinates: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  description: string;
  detail: string;
};

export const DESTINATIONS: Destination[] = [
  { id: "san-salvador", name: "San Salvador", region: "San Salvador", kind: "city", coordinates: [-89.1913, 13.6989], zoom: 15, pitch: 58, bearing: -25, description: "El corazón de la capital", detail: "Explora las calles y las huellas reales de los edificios alrededor del Centro Histórico." },
  { id: "santa-ana", name: "Volcán de Santa Ana", region: "Santa Ana", kind: "volcano", coordinates: [-89.6309, 13.8534], zoom: 12.5, pitch: 62, bearing: -28, description: "La cima del occidente", detail: "El relieve de la cordillera de Apaneca-Ilamatepec revela el cráter del volcán de Santa Ana." },
  { id: "coatepeque", name: "Lago de Coatepeque", region: "Santa Ana", kind: "lake", coordinates: [-89.5489, 13.8648], zoom: 12.1, pitch: 55, bearing: 20, description: "Agua entre montañas", detail: "Una caldera volcánica y su lago, rodeados por las laderas verdes del occidente." },
  { id: "el-tunco", name: "El Tunco", region: "La Libertad", kind: "coast", coordinates: [-89.3824, 13.4944], zoom: 15.1, pitch: 55, bearing: 155, description: "La costa del Pacífico", detail: "Acércate al litoral de La Libertad y sigue sus caminos costeros hacia las playas." },
  { id: "suchitoto", name: "Suchitoto", region: "Cuscatlán", kind: "heritage", coordinates: [-89.0277, 13.9382], zoom: 14.8, pitch: 55, bearing: -30, description: "Calles con historia", detail: "Recorre la trama de Suchitoto, junto al paisaje del embalse Cerrón Grande." },
  { id: "el-boqueron", name: "El Boquerón", region: "San Salvador", kind: "volcano", coordinates: [-89.2867, 13.7348], zoom: 13.1, pitch: 62, bearing: 30, description: "El guardián de la capital", detail: "Sobrevuela el cráter del volcán de San Salvador y observa la ciudad desde sus laderas." },
  { id: "ilopango", name: "Lago de Ilopango", region: "San Salvador · Cuscatlán · La Paz", kind: "lake", coordinates: [-89.052, 13.675], zoom: 11.7, pitch: 55, bearing: -20, description: "Una caldera de azul", detail: "Explora la forma del lago de Ilopango y los caminos que conectan sus orillas." },
  { id: "san-miguel", name: "San Miguel", region: "San Miguel", kind: "city", coordinates: [-88.176, 13.4833], zoom: 14.6, pitch: 56, bearing: -18, description: "El corazón de oriente", detail: "Descubre la ciudad de San Miguel y continúa hacia el volcán Chaparrastique." },
  { id: "chaparrastique", name: "Chaparrastique", region: "San Miguel", kind: "volcano", coordinates: [-88.269, 13.434], zoom: 12.2, pitch: 62, bearing: -35, description: "La silueta de oriente", detail: "El relieve real del volcán de San Miguel destaca sobre las llanuras del oriente." },
  { id: "ruta-flores", name: "Ruta de las Flores", region: "Ahuachapán · Sonsonate", kind: "heritage", coordinates: [-89.841, 13.842], zoom: 11.4, pitch: 54, bearing: -25, description: "Pueblos entre cafetales", detail: "Explora el paisaje de Apaneca y sus conexiones hacia los pueblos de la Ruta de las Flores." },
  { id: "jiquilisco", name: "Bahía de Jiquilisco", region: "Usulután", kind: "coast", coordinates: [-88.544, 13.217], zoom: 11.2, pitch: 48, bearing: 12, description: "Islas, canales y manglares", detail: "Sigue el contorno real de la bahía y sus canales en el litoral de Usulután." },
  { id: "la-union", name: "Golfo de Fonseca", region: "La Unión", kind: "coast", coordinates: [-87.824, 13.287], zoom: 10.7, pitch: 52, bearing: -20, description: "Donde termina la costa", detail: "Descubre La Unión y el paisaje de islas y volcanes que rodea el golfo." },
];

export const KIND_LABEL: Record<DestinationKind, string> = {
  city: "Ciudades", volcano: "Volcanes", lake: "Lagos", coast: "Costa", heritage: "Pueblos",
};

export function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("es");
}

export function filterDestinations(query: string, kind: DestinationKind | "all" = "all") {
  const normalized = normalizeSearch(query);
  return DESTINATIONS.filter((place) =>
    (kind === "all" || place.kind === kind) &&
    normalizeSearch(`${place.name} ${place.region} ${KIND_LABEL[place.kind]}`).includes(normalized),
  );
}

export const COUNTRY_VIEW = { center: [-88.92, 13.68] as [number, number], zoom: 7.65, pitch: 48, bearing: -12 };
