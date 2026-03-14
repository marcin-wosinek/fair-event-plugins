import './style.css';
import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	TextControl,
	TextareaControl,
	ToggleControl,
	CheckboxControl,
	Spinner,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import ServerSideRender from '@wordpress/server-side-render';

registerBlockType('fair-audience/mailing-signup', {
	edit: ({ attributes, setAttributes }) => {
		const {
			submitButtonText,
			successMessage,
			showCategories,
			categoryIds,
			preselectedCategoryIds,
		} = attributes;

		const blockProps = useBlockProps({
			className: 'fair-audience-mailing-signup',
		});

		const { categories, isLoading } = useSelect(
			(select) => {
				if (!showCategories) {
					return { categories: [], isLoading: false };
				}
				const query = { per_page: 100, hide_empty: false };
				return {
					categories:
						select(coreStore).getEntityRecords(
							'taxonomy',
							'category',
							query
						) || [],
					isLoading: select(coreStore).isResolving(
						'getEntityRecords',
						['taxonomy', 'category', query]
					),
				};
			},
			[showCategories]
		);

		const toggleCategoryId = (id, list, attr) => {
			const updated = list.includes(id)
				? list.filter((cid) => cid !== id)
				: [...list, id];
			setAttributes({ [attr]: updated });
		};

		return (
			<>
				<InspectorControls>
					<PanelBody title={__('Form Settings', 'fair-audience')}>
						<TextControl
							label={__('Submit Button Text', 'fair-audience')}
							value={submitButtonText}
							onChange={(value) =>
								setAttributes({ submitButtonText: value })
							}
							placeholder={__('Subscribe', 'fair-audience')}
						/>
						<TextareaControl
							label={__('Success Message', 'fair-audience')}
							value={successMessage}
							onChange={(value) =>
								setAttributes({ successMessage: value })
							}
							placeholder={__(
								'Please check your email to confirm your subscription.',
								'fair-audience'
							)}
							help={__(
								'Message shown after successful signup.',
								'fair-audience'
							)}
						/>
					</PanelBody>
					<PanelBody
						title={__('Category Preferences', 'fair-audience')}
					>
						<ToggleControl
							label={__(
								'Show category preferences',
								'fair-audience'
							)}
							checked={showCategories}
							onChange={(value) =>
								setAttributes({ showCategories: value })
							}
							help={__(
								'Let subscribers choose which categories of content they want to receive.',
								'fair-audience'
							)}
						/>
						{showCategories && isLoading && <Spinner />}
						{showCategories &&
							!isLoading &&
							categories.length > 0 && (
								<>
									<p className="components-base-control__help">
										{__(
											'Select which categories to show in the form. If none are selected, all categories will be shown.',
											'fair-audience'
										)}
									</p>
									<fieldset className="fair-audience-category-fieldset">
										<legend className="components-base-control__label">
											{__(
												'Available categories',
												'fair-audience'
											)}
										</legend>
										{categories.map((cat) => (
											<CheckboxControl
												key={cat.id}
												label={cat.name}
												checked={categoryIds.includes(
													cat.id
												)}
												onChange={() =>
													toggleCategoryId(
														cat.id,
														categoryIds,
														'categoryIds'
													)
												}
											/>
										))}
									</fieldset>
									<fieldset className="fair-audience-category-fieldset">
										<legend className="components-base-control__label">
											{__(
												'Preselected categories',
												'fair-audience'
											)}
										</legend>
										<p className="components-base-control__help">
											{__(
												'Categories checked by default when the form loads.',
												'fair-audience'
											)}
										</p>
										{(categoryIds.length > 0
											? categories.filter((cat) =>
													categoryIds.includes(cat.id)
											  )
											: categories
										).map((cat) => (
											<CheckboxControl
												key={cat.id}
												label={cat.name}
												checked={preselectedCategoryIds.includes(
													cat.id
												)}
												onChange={() =>
													toggleCategoryId(
														cat.id,
														preselectedCategoryIds,
														'preselectedCategoryIds'
													)
												}
											/>
										))}
									</fieldset>
								</>
							)}
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<ServerSideRender
						block="fair-audience/mailing-signup"
						attributes={attributes}
					/>
				</div>
			</>
		);
	},
	save: () => {
		return null; // Dynamic block, rendered via PHP
	},
});
