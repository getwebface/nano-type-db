import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    maxWidth?: string;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, maxWidth = 'max-w-md' }) => {
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            ref={overlayRef}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
        >
            <div className={`bg-slate-900 border border-slate-700 rounded-lg ${maxWidth} w-full max-h-[80vh] overflow-hidden flex flex-col`}>
                <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white">{title}</h2>
                    <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-white">
                        <X size={18} />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto flex-1">{children}</div>
                {footer && (
                    <div className="p-6 border-t border-slate-800 flex justify-end gap-3">{footer}</div>
                )}
            </div>
        </div>
    );
};

interface ConfirmDialogProps {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    title: string;
    message: string;
    confirmLabel?: string;
    confirmVariant?: 'danger' | 'primary';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen, onConfirm, onCancel, title, message, confirmLabel = 'Confirm', confirmVariant = 'primary'
}) => {
    const btnClass = confirmVariant === 'danger'
        ? 'bg-red-600 hover:bg-red-700'
        : 'bg-green-600 hover:bg-green-700';

    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            title={title}
            footer={
                <>
                    <button onClick={onCancel} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button onClick={onConfirm} className={`px-4 py-2 ${btnClass} text-white rounded-lg transition-colors`}>
                        {confirmLabel}
                    </button>
                </>
            }
        >
            <p className="text-slate-300 whitespace-pre-wrap">{message}</p>
        </Modal>
    );
};

interface PromptDialogProps {
    isOpen: boolean;
    onConfirm: (value: string) => void;
    onCancel: () => void;
    title: string;
    message: string;
    placeholder?: string;
    confirmLabel?: string;
    validate?: (value: string) => string | null;
}

export const PromptDialog: React.FC<PromptDialogProps> = ({
    isOpen, onConfirm, onCancel, title, message, placeholder = '', confirmLabel = 'Confirm', validate
}) => {
    const [value, setValue] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setValue('');
            setError(null);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    const handleSubmit = () => {
        if (!value.trim()) {
            setError('This field is required');
            return;
        }
        if (validate) {
            const validationError = validate(value);
            if (validationError) {
                setError(validationError);
                return;
            }
        }
        onConfirm(value);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            title={title}
            footer={
                <>
                    <button onClick={onCancel} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button onClick={handleSubmit} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors">
                        {confirmLabel}
                    </button>
                </>
            }
        >
            <p className="text-slate-300 mb-4">{message}</p>
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                placeholder={placeholder}
                className={`w-full bg-slate-800 text-slate-100 px-4 py-2 rounded border ${error ? 'border-red-500' : 'border-slate-700'} focus:outline-none focus:border-green-500`}
            />
            {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </Modal>
    );
};
