import { QuillConfig, QuillModules } from './quill-editor.interfaces';
import { isPlatformServer } from '@angular/common';

import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  forwardRef,
  Inject,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  PLATFORM_ID,
  Renderer2,
  SimpleChanges,
  ViewEncapsulation
} from '@angular/core';

import {
  NG_VALUE_ACCESSOR,
  NG_VALIDATORS,
  ControlValueAccessor,
  Validator
} from '@angular/forms';

import { DOCUMENT } from '@angular/common';

// import * as QuillNamespace from 'quill';
// Because quill uses `document` directly, we cannot `import` during SSR
// instead, we load dynamically via `require('quill')` in `ngAfterViewInit()`
declare var require: any;
var Quill: any = undefined;

export interface CustomOption {
  import: string;
  whitelist: Array<any>;
}

@Component({
  selector: 'quill-editor',
  template: `
  <ng-content select="[quill-editor-toolbar]"></ng-content>
`,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => QuillEditorComponent),
      multi: true
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => QuillEditorComponent),
      multi: true
    }
  ],
  encapsulation: ViewEncapsulation.None
})
export class QuillEditorComponent
  implements AfterViewInit, ControlValueAccessor, OnChanges, OnDestroy, Validator {
  quillEditor: any;
  editorElem: HTMLElement;
  emptyArray: any[] = [];
  content: any;
  selectionChangeEvent: any;
  textChangeEvent: any;
  defaultModules: QuillModules | {};

  private disabled = false; // used to store initial value before ViewInit

  @Input() format: 'object' | 'html' | 'text' | 'json' = 'html';
  @Input() theme: string;
  @Input() modules: { [index: string]: Object };
  @Input() readOnly: boolean;
  @Input() placeholder: string;
  @Input() maxLength: number;
  @Input() minLength: number;
  @Input() required: boolean;
  @Input() formats: string[];
  @Input() style: any = {};
  @Input() strict: boolean = true;
  @Input() scrollingContainer: HTMLElement | string;
  @Input() bounds: HTMLElement | string;
  @Input() customOptions: CustomOption[] = [];

  @Output() onEditorCreated: EventEmitter<any> = new EventEmitter();
  @Output() onContentChanged: EventEmitter<any> = new EventEmitter();
  @Output() onSelectionChanged: EventEmitter<any> = new EventEmitter();

  @Input()
  valueGetter = (quillEditor: any, editorElement: HTMLElement): any => {
    let html: string | null = editorElement.children[0].innerHTML;
    if (html === '<p><br></p>' || html === '<div><br><div>') {
      html = null;
    }
    let modelValue = html;

    if (this.format === 'text') {
      modelValue = quillEditor.getText();
    } else if (this.format === 'object') {
      modelValue = quillEditor.getContents();
    } else if (this.format === 'json') {
      try {
        modelValue = JSON.stringify(quillEditor.getContents());
      } catch (e) {
        modelValue = quillEditor.getText();
      }
    }

    return modelValue;
  }

  @Input()
  valueSetter = (quillEditor: any, value: any): any => {
    if (this.format === 'html') {
      return quillEditor.clipboard.convert(value);
    } else if (this.format === 'json') {
      try {
        return JSON.parse(value);
      } catch (e) {
        return value;
      }
    }

    return value;
  }

  onModelChange: Function = () => {};
  onModelTouched: Function = () => {};

  constructor(
    private elementRef: ElementRef,
    @Inject(DOCUMENT) private doc: any,
    @Inject(PLATFORM_ID) private platformId: Object,
    private renderer: Renderer2,
    private zone: NgZone,
    @Inject('config') private config: QuillConfig,
  ) {
    this.defaultModules = this.config && this.config.modules || {};
  }

  ngAfterViewInit() {
    if (isPlatformServer(this.platformId)) {
      return;
    }
    if (!Quill) {
      Quill = require('quill');
    }

    const toolbarElem = this.elementRef.nativeElement.querySelector(
      '[quill-editor-toolbar]'
    );
    let modules = this.modules || this.defaultModules;
    let placeholder = 'Insert text here ...';

    if (this.placeholder !== null && this.placeholder !== undefined) {
      placeholder = this.placeholder.trim();
    }

    if (toolbarElem) {
      modules['toolbar'] = toolbarElem;
    }
    this.elementRef.nativeElement.insertAdjacentHTML(
      'beforeend',
      '<div quill-editor-element></div>'
    );
    this.editorElem = this.elementRef.nativeElement.querySelector(
      '[quill-editor-element]'
    );

    if (this.style) {
      Object.keys(this.style).forEach((key: string) => {
        this.renderer.setStyle(this.editorElem, key, this.style[key]);
      });
    }

    this.customOptions.forEach(customOption => {
      const newCustomOption = Quill.import(customOption.import);
      newCustomOption.whitelist = customOption.whitelist;
      Quill.register(newCustomOption, true);
    });

    this.quillEditor = new Quill(this.editorElem, {
      modules: modules,
      placeholder: placeholder,
      readOnly: this.readOnly || false,
      theme: this.theme || 'snow',
      formats: this.formats,
      bounds: this.bounds ? (this.bounds === 'self' ? this.editorElem : this.bounds) : this.doc.body,
      strict: this.strict,
      scrollingContainer: this.scrollingContainer
    });

    if (this.content) {
      if (this.format === 'object') {
        this.quillEditor.setContents(this.content, 'silent');
      } else if (this.format === 'text') {
        this.quillEditor.setText(this.content, 'silent');
      } else if (this.format === 'json') {
        try {
          this.quillEditor.setContents(JSON.parse(this.content), 'silent');
        } catch (e) {
          this.quillEditor.setText(this.content, 'silent');
        }
      } else {
        const contents = this.quillEditor.clipboard.convert(this.content);
        this.quillEditor.setContents(contents, 'silent');
      }

      this.quillEditor.history.clear();
    }

    // initialize disabled status based on this.disabled as default value
    this.setDisabledState();

    this.onEditorCreated.emit(this.quillEditor);

    // mark model as touched if editor lost focus
    this.selectionChangeEvent = this.quillEditor.on(
      'selection-change',
      (range: any, oldRange: any, source: string) => {
        this.zone.run(() => {
          this.onSelectionChanged.emit({
            editor: this.quillEditor,
            range: range,
            oldRange: oldRange,
            source: source
          });

          if (!range) {
            this.onModelTouched();
          }
        });
      }
    );

    // update model if text changes
    this.textChangeEvent = this.quillEditor.on(
      'text-change',
      (delta: any, oldDelta: any, source: string) => {

        const text = this.quillEditor.getText();
        const content = this.quillEditor.getContents();

        let html: string | null = this.editorElem.children[0].innerHTML;
        if (html === '<p><br></p>' || html === '<div><br><div>') {
          html = null;
        }

        this.zone.run(() => {
          this.onModelChange(
            this.valueGetter(this.quillEditor, this.editorElem)
          );

          this.onContentChanged.emit({
            editor: this.quillEditor,
            html: html,
            text: text,
            content: content,
            delta: delta,
            oldDelta: oldDelta,
            source: source
          });
        });
      }
    );
  }

  ngOnDestroy() {
    if (this.selectionChangeEvent) {
      this.selectionChangeEvent.removeListener('selection-change');
    }
    if (this.textChangeEvent) {
      this.textChangeEvent.removeListener('text-change');
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.quillEditor) {
      return;
    }
    if (changes['readOnly']) {
      this.quillEditor.enable(!changes['readOnly'].currentValue);
    }
    if (changes['placeholder']) {
      this.quillEditor.root.dataset.placeholder =
        changes['placeholder'].currentValue;
    }
  }

  writeValue(currentValue: any) {
    this.content = currentValue;

    if (this.quillEditor) {
      if (currentValue) {
        if (this.format === 'text') {
          this.quillEditor.setText(currentValue);
        } else {
          this.quillEditor.setContents(
            this.valueSetter(this.quillEditor, this.content)
          );
        }
        return;
      }
      this.quillEditor.setText('');
    }
  }

  setDisabledState(isDisabled: boolean = this.disabled): void {
    // store initial value to set appropriate disabled status after ViewInit
    this.disabled = isDisabled;
    if (this.quillEditor) {
      if (isDisabled) {
        this.quillEditor.disable();
        this.renderer.setAttribute(this.elementRef.nativeElement, 'disabled', 'disabled');
      } else {
        this.quillEditor.enable();
        this.renderer.removeAttribute(this.elementRef.nativeElement, 'disabled');
      }
    }
  }

  registerOnChange(fn: Function): void {
    this.onModelChange = fn;
  }

  registerOnTouched(fn: Function): void {
    this.onModelTouched = fn;
  }

  validate() {
    if (!this.quillEditor) {
      return null;
    }

    let err: {
        minLengthError?: { given: number; minLength: number };
        maxLengthError?: { given: number; maxLength: number };
        requiredError?: { empty: boolean };
      } = {},
      valid = true;

    const textLength = this.quillEditor.getText().trim().length;

    if (this.minLength && textLength && textLength < this.minLength) {
      err.minLengthError = {
        given: textLength,
        minLength: this.minLength
      };

      valid = false;
    }

    if (this.maxLength && textLength > this.maxLength) {
      err.maxLengthError = {
        given: textLength,
        maxLength: this.maxLength
      };

      valid = false;
    }

    if (this.required && !textLength) {
      err.requiredError = {
        empty: true
      };

      valid = false;
    }

    return valid ? null : err;
  }
}
