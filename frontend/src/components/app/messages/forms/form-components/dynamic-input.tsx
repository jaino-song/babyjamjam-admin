import { TemplateVariable } from "@/lib/template/types";
import { DateInput } from "./date-input";
import { NumberInput } from "./number-input";
import { TextareaInput } from "./textarea-input";
import { DynamicSelect } from "./dynamic-select";
import { NameInput } from "./NameInput";
import { ContactInput } from "./ContactInput";
import { TitleTextInputMolecule } from "./TitleTextInputMolecule";

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
                    <TitleTextInputMolecule
                        label={label}
                        value={value}
                        onValueChange={onChange}
                        placeholder={placeholder}
                        required={required}
                        dataComponent="messages-form-dynamic-text-input"
                    />
                );
            }
            break;
        default:
            content = (
                <TitleTextInputMolecule
                    label={label}
                    value={value}
                    onValueChange={onChange}
                    placeholder={placeholder}
                    required={required}
                    dataComponent="messages-form-default-text-input"
                />
            );
    }

    return (
        <div data-component="messages-form-dynamic-input">
            {content}
        </div>
    );
};
