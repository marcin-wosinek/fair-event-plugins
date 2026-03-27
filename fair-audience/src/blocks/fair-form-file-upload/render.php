<?php
/**
 * Render callback for the Fair Form File Upload question block
 *
 * @package FairAudience
 * @param array    $attributes Block attributes.
 * @param string   $content    Block content.
 * @param WP_Block $block      Block instance.
 * @return string Rendered block HTML.
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in block render templates are scoped to the template and don't need prefixing.
 */

defined( 'WPINC' ) || die;

$question_text  = $attributes['questionText'] ?? '';
$question_key   = $attributes['questionKey'] ?? '';
$required       = ! empty( $attributes['required'] );
$accepted_types = $attributes['acceptedTypes'] ?? 'image/*';
$max_file_size  = $attributes['maxFileSize'] ?? 5;

// Skip rendering if no question text is set.
if ( empty( $question_text ) ) {
	return '';
}

// Generate unique ID for this input.
$input_id = 'fair-form-q-' . sanitize_title( $question_key ) . '-' . wp_unique_id();

$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                   => 'fair-form-question fair-form-question-file-upload',
		'data-fair-form-question' => '',
		'data-question-key'       => esc_attr( $question_key ),
		'data-question-text'      => esc_attr( $question_text ),
		'data-question-type'      => 'file_upload',
		'data-required'           => $required ? '1' : '0',
		'data-max-file-size'      => esc_attr( $max_file_size ),
		'data-accepted-types'     => esc_attr( $accepted_types ),
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<label for="<?php echo esc_attr( $input_id ); ?>">
		<?php echo esc_html( $question_text ); ?>
		<?php if ( $required ) : ?>
			<span class="required">*</span>
		<?php endif; ?>
	</label>
	<input
		type="file"
		id="<?php echo esc_attr( $input_id ); ?>"
		name="<?php echo esc_attr( 'fair_form_file_' . $question_key ); ?>"
		<?php if ( $required ) : ?>
			required
		<?php endif; ?>
		<?php if ( ! empty( $accepted_types ) ) : ?>
			accept="<?php echo esc_attr( $accepted_types ); ?>"
		<?php endif; ?>
	/>
	<span class="fair-form-file-upload-help">
		<?php
		printf(
			/* translators: %d: maximum file size in megabytes */
			esc_html__( 'Max file size: %d MB', 'fair-audience' ),
			(int) $max_file_size
		);
		?>
	</span>
</div>
