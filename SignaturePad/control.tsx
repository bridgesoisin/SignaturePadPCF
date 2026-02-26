import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import SignaturePadComponent from "./SignaturePadComponent";

export class SignaturePad implements ComponentFramework.StandardControl<IInputs, IOutputs> {

    private _container:          HTMLDivElement | undefined;
    private _notifyOutputChanged: (() => void)  | undefined;
    private _root:               Root | null    = null;
    private _resizeObserver:     ResizeObserver | undefined;

    // The three output values — all written at once when surveyor taps Save
    private _value:     string = "";   // full JSON  → rt_planjson
    private _beforePng: string = "";   // base64 PNG → rt_beforepng
    private _afterPng:  string = "";   // base64 PNG → rt_afterpng

    // Input from Power Apps
    private _sketchName: string = "";

    // Live dimensions tracked by ResizeObserver
    private _width:  number = 800;
    private _height: number = 600;

    constructor() {}

    public init(
        context:            ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state:             ComponentFramework.Dictionary,
        container:          HTMLDivElement
    ): void {
        this._notifyOutputChanged = notifyOutputChanged;
        this._container           = container;

        container.style.width    = "100%";
        container.style.height   = "100%";
        container.style.display  = "block";
        container.style.overflow = "hidden";

        // ResizeObserver — reliable sizing regardless of Power Apps layout type.
        // Fires whenever the control container changes size (e.g. screen resize,
        // panel open/close). Replaces the fragile closest(".control-container") hack.
        this._resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    this._width  = Math.floor(width);
                    this._height = Math.floor(height);
                    this._render();
                }
            }
        });
        this._resizeObserver.observe(container);

        this._root = createRoot(container);
        this.updateView(context);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        // Read bound values — pre-populate if the surveyor reopens a saved sketch
        const incomingValue = context.parameters.value.raw ?? "";
        if (this._value !== incomingValue) this._value = incomingValue;

        // beforePng / afterPng are output-only in practice but the manifest marks
        // them as bound so Power Apps can read them back. We don't need to read
        // them inbound — the JSON in value is what the PCF uses to restore the sketch.

        this._sketchName = context.parameters.sketchName?.raw ?? "";

        // Fallback dimensions if ResizeObserver hasn't fired yet
        if (this._container) {
            const w = this._container.clientWidth;
            const h = this._container.clientHeight;
            if (w > 0) this._width  = w;
            if (h > 0) this._height = h;
        }

        this._render();
    }

    private _render(): void {
        if (!this._root) return;
        this._root.render(
            <React.StrictMode>
                <SignaturePadComponent
                    value={this._value}
                    sketchName={this._sketchName}
                    width={this._width}
                    height={this._height}
                    onSave={(json: string, beforePng: string, afterPng: string) => {
                        // Called when surveyor taps "Save to Power Apps"
                        // All three outputs updated atomically before notifying Power Apps
                        this._value     = json;
                        this._beforePng = beforePng;
                        this._afterPng  = afterPng;
                        this._notifyOutputChanged?.();
                    }}
                />
            </React.StrictMode>
        );
    }

    public getOutputs(): IOutputs {
        return {
            value:     this._value,
            beforePng: this._beforePng,
            afterPng:  this._afterPng,
        };
    }

    public destroy(): void {
        this._resizeObserver?.disconnect();
        this._root?.unmount();
    }
}
