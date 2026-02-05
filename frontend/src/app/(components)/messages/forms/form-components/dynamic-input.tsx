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

    switch (type) {
        case "date":
            return <DateInput value={value} onChange={onChange} label={label} required={required} />;
        case "number":
            return (
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
        case "textarea":
            return <TextareaInput value={value} onChange={onChange} label={label} placeholder={placeholder} required={required} />;
        case "select":
            return (
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
        case "phone":
            return <ContactInput phone={value} setPhone={onChange} label={label} placeholder={placeholder || ""} />;
        case "text":
            if (variable.key === "name") {
                return <NameInput name={value} setName={onChange} label={label} placeholder={placeholder || ""} />;
            }
            return (
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
        default:
            return (
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
};
