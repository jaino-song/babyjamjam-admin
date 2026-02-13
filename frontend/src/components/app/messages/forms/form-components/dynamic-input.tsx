import { TemplateVariable } from "@/lib/template/types";
import { DateInput } from "./date-input";
import { NumberInput } from "./number-input";
import { TextareaInput } from "./textarea-input";
import { DynamicSelect } from "./dynamic-select";
import { NameInput } from "./NameInput";
import { ContactInput } from "./ContactInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DynamicInputProps {
    variable: TemplateVariable;
    value: string;
    onChange: (value: string) => void;
}

export const DynamicInput = ({ variable, value, onChange }: DynamicInputProps) => {
    const { type, label, placeholder, required, optionType, options, dataSource } = variable;

    let content;

    switch (type) {
        case "date":
            content = <DateInput value={value} onChange={onChange} label={label} required={required} />;
            break;
        case "number":
            content = (
                <NumberInput 
                    value={value} 
                    onChange={onChange} 
                    label={label} 
                    placeholder={placeholder} 
                    required={required} 
                    min={variable.min} 
                    max={variable.max} 
                />
            );
            break;
        case "textarea":
            content = <TextareaInput value={value} onChange={onChange} label={label} placeholder={placeholder} required={required} />;
            break;
        case "select":
            content = (
                <DynamicSelect 
                    value={value} 
                    onChange={onChange} 
                    label={label} 
                    required={required} 
                    optionType={optionType} 
                    options={options} 
                    dataSourceId={dataSource} 
                />
            );
            break;
        case "phone":
            content = <ContactInput phone={value} setPhone={onChange} label={label} placeholder={placeholder || ""} />;
            break;
        case "text":
            if (variable.key === "name") {
                content = <NameInput name={value} setName={onChange} label={label} placeholder={placeholder || ""} />;
            } else {
                content = (
                    <div className="space-y-2">
                        <Label>
                            {label}
                            {required && <span className="text-destructive ml-1">*</span>}
                        </Label>
                        <Input
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            placeholder={placeholder}
                            className="bg-background"
                        />
                    </div>
                );
            }
            break;
        default:
            content = (
                <div className="space-y-2">
                    <Label>
                        {label}
                        {required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    <Input
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder}
                        className="bg-background"
                    />
                </div>
            );
    }

    return (
        <div data-component="messages-form-dynamic-input">
            {content}
        </div>
    );
};
