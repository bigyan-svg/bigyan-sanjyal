"use client";

import { useEffect, useRef } from "react";
import {
  DismissableLayerManager,
  type DismissableLayerRegistration,
} from "@/lib/dismissable-layer-manager";

export interface DismissableElementRef {
  readonly current: HTMLElement | null;
}

export interface DismissableLayerOptions {
  enabled: boolean;
  insideRefs: readonly DismissableElementRef[];
  onOutsideClick: () => void;
  onEscape?: () => void;
}

const layerManager = new DismissableLayerManager();
let listeningDocument: Document | null = null;

function handleDocumentPointerDown(event: PointerEvent): void {
  layerManager.handlePointerDown(event);
}

function handleDocumentKeyDown(event: KeyboardEvent): void {
  layerManager.handleKeyDown(event);
}

function registerLayer(layer: DismissableLayerRegistration, ownerDocument: Document): () => void {
  if (layerManager.size === 0) {
    listeningDocument = ownerDocument;
    listeningDocument.addEventListener("pointerdown", handleDocumentPointerDown, true);
    listeningDocument.addEventListener("keydown", handleDocumentKeyDown, true);
  }

  const unregister = layerManager.register(layer);

  return () => {
    unregister();
    if (layerManager.size === 0 && listeningDocument) {
      listeningDocument.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      listeningDocument.removeEventListener("keydown", handleDocumentKeyDown, true);
      listeningDocument = null;
    }
  };
}

export function useDismissableLayer({
  enabled,
  insideRefs,
  onOutsideClick,
  onEscape,
}: DismissableLayerOptions): void {
  const idRef = useRef(Symbol("dismissable-layer"));
  const optionsRef = useRef({ insideRefs, onOutsideClick, onEscape });

  useEffect(() => {
    optionsRef.current = { insideRefs, onOutsideClick, onEscape };
  }, [insideRefs, onOutsideClick, onEscape]);

  useEffect(() => {
    if (!enabled) return;

    const ownerDocument = optionsRef.current.insideRefs.find((ref) => ref.current)?.current?.ownerDocument ?? document;
    const layer: DismissableLayerRegistration = {
      id: idRef.current,
      getInsideElements: () => optionsRef.current.insideRefs.map((ref) => ref.current),
      onOutsideClick: () => optionsRef.current.onOutsideClick(),
    };
    if (optionsRef.current.onEscape) {
      layer.onEscape = () => optionsRef.current.onEscape?.();
    }

    return registerLayer(layer, ownerDocument);
  }, [enabled]);
}
