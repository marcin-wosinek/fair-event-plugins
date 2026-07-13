/**
 * WordPress dependencies
 */
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
} from '@wordpress/element';

/**
 * Uncontrolled textarea with a Quicktags (Text-mode) toolbar.
 *
 * Quicktags mutates the textarea DOM directly, which conflicts with a React
 * controlled value, so the field is seeded once on mount and callers read
 * its current value via `ref.current.getValue()` at save time.
 *
 * @param {Object}   props
 * @param {string}   props.id           Stable id for the wp.editor instance.
 * @param {string}   props.label        Field label.
 * @param {string}   [props.help]       Optional help text.
 * @param {string}   props.defaultValue Initial textarea content.
 * @param {boolean}  [props.disabled]   Disable the textarea.
 * @param {Object}   ref                Forwarded ref exposing `getValue()`.
 * @return {JSX.Element} The quicktags-enabled textarea field.
 */
const QuicktagsTextarea = forwardRef(function QuicktagsTextarea(
	{ id, label, help, defaultValue, disabled },
	ref
) {
	const textareaRef = useRef(null);

	useImperativeHandle(ref, () => ({
		getValue: () => textareaRef.current?.value ?? '',
	}));

	useEffect(() => {
		if (window.wp && window.wp.editor) {
			window.wp.editor.initialize(id, {
				quicktags: true,
				tinymce: false,
				mediaButtons: false,
			});
		}

		return () => {
			if (window.wp && window.wp.editor) {
				window.wp.editor.remove(id);
			}
		};
	}, [id]);

	return (
		<div style={{ marginBottom: '16px' }}>
			<label
				htmlFor={id}
				style={{
					display: 'block',
					marginBottom: '8px',
					fontWeight: '600',
				}}
			>
				{label}
			</label>
			<textarea
				ref={textareaRef}
				id={id}
				rows={6}
				style={{ width: '100%' }}
				defaultValue={defaultValue}
				disabled={disabled}
			/>
			{help && (
				<p
					style={{
						color: '#757575',
						fontSize: '13px',
						marginTop: '4px',
					}}
				>
					{help}
				</p>
			)}
		</div>
	);
});

export default QuicktagsTextarea;
