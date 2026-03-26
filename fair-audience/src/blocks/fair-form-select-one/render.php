<?php
/**
 * Render callback for the Fair Form Select One question block
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

$question_text = $attributes['questionText'] ?? '';
$question_key  = $attributes['questionKey'] ?? '';
$required      = ! empty( $attributes['required'] );
$display_as    = $attributes['displayAs'] ?? 'select';

// Skip rendering if no question text is set.
if ( empty( $question_text ) ) {
	return '';
}

// Collect options from inner blocks.
$options = array();
foreach ( $block->inner_blocks as $inner_block ) {
	if ( 'fair-audience/fair-form-option' === $inner_block->name ) {
		$value = $inner_block->attributes['value'] ?? '';
		if ( '' !== $value ) {
			$options[] = $value;
		}
	}
}

// Generate unique ID for this input.
$input_id = 'fair-form-q-' . sanitize_title( $question_key ) . '-' . wp_unique_id();

$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                   => 'fair-form-question fair-form-question-select-one',
		'data-fair-form-question' => '',
		'data-question-key'       => esc_attr( $question_key ),
		'data-question-text'      => esc_attr( $question_text ),
		'data-question-type'      => 'select',
		'data-required'           => $required ? '1' : '0',
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

	<?php if ( 'radio' === $display_as ) : ?>
		<fieldset id="<?php echo esc_attr( $input_id ); ?>" class="fair-form-radio-fieldset">
			<?php foreach ( $options as $option ) : ?>
				<label class="fair-form-radio-label">
					<input
						type="radio"
						name="<?php echo esc_attr( 'fair_form_q_' . $question_key ); ?>"
						value="<?php echo esc_attr( $option ); ?>"
						<?php if ( $required ) : ?>
							required
						<?php endif; ?>
					/>
					<?php echo esc_html( $option ); ?>
				</label>
			<?php endforeach; ?>
		</fieldset>
	<?php else : ?>
		<select
			id="<?php echo esc_attr( $input_id ); ?>"
			name="<?php echo esc_attr( 'fair_form_q_' . $question_key ); ?>"
			<?php if ( $required ) : ?>
				required
			<?php endif; ?>
		>
			<option value=""><?php echo esc_html__( 'Select an option...', 'fair-audience' ); ?></option>
			<?php foreach ( $options as $option ) : ?>
				<option value="<?php echo esc_attr( $option ); ?>">
					<?php echo esc_html( $option ); ?>
				</option>
			<?php endforeach; ?>
		</select>
	<?php endif; ?>
</div>
