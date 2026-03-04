<?php
/**
 * Render callback for the Audience Signup block
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

use FairEvents\Models\EventDates;

// Get block attributes.
$submit_text        = $attributes['submitButtonText'] ?? __( 'Register', 'fair-audience' );
$success_message    = $attributes['successMessage'] ?? __( 'You have been registered successfully!', 'fair-audience' );
$show_instagram     = $attributes['showInstagram'] ?? false;
$show_keep_informed = $attributes['showKeepInformed'] ?? true;
$questions          = $attributes['questions'] ?? array();
$event_date_id_attr = $attributes['eventDateId'] ?? 0;

// Resolve event_date_id: use attribute if set, otherwise auto-detect from current event post.
$event_date_id = '';
if ( $event_date_id_attr > 0 ) {
	$event_date_id = (string) $event_date_id_attr;
} elseif ( class_exists( EventDates::class ) ) {
	$post_id = get_the_ID();
	if ( $post_id && \FairEvents\Database\EventRepository::is_event( $post_id ) ) {
		$event_dates_obj = EventDates::get_by_event_id( $post_id );
		if ( $event_dates_obj ) {
			$event_date_id = (string) $event_dates_obj->id;
		}
	}
}

// Generate unique ID for this form instance.
$form_id = 'fair-audience-audience-' . wp_unique_id();

// Build wrapper data attributes.
$wrapper_data = array(
	'class'                => 'fair-audience-audience-signup',
	'data-success-message' => esc_attr( $success_message ),
	'data-questions'       => wp_json_encode( $questions ),
);

if ( '' !== $event_date_id ) {
	$wrapper_data['data-event-date-id'] = esc_attr( $event_date_id );
}

// Get wrapper attributes.
$wrapper_attributes = get_block_wrapper_attributes( $wrapper_data );
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<form class="fair-audience-audience-form">
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-name">
				<?php echo esc_html__( 'First Name', 'fair-audience' ); ?> <span class="required">*</span>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-name"
				name="audience_name"
				required
				placeholder="<?php echo esc_attr__( 'Enter your first name', 'fair-audience' ); ?>"
			/>
		</p>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-surname">
				<?php echo esc_html__( 'Last Name', 'fair-audience' ); ?>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-surname"
				name="audience_surname"
				placeholder="<?php echo esc_attr__( 'Enter your last name', 'fair-audience' ); ?>"
			/>
		</p>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-email">
				<?php echo esc_html__( 'Email', 'fair-audience' ); ?> <span class="required">*</span>
			</label>
			<input
				type="email"
				id="<?php echo esc_attr( $form_id ); ?>-email"
				name="audience_email"
				required
				placeholder="<?php echo esc_attr__( 'Enter your email', 'fair-audience' ); ?>"
			/>
		</p>

		<?php if ( $show_instagram ) : ?>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-instagram">
				<?php echo esc_html__( 'Instagram', 'fair-audience' ); ?>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-instagram"
				name="audience_instagram"
				placeholder="<?php echo esc_attr__( '@username', 'fair-audience' ); ?>"
			/>
		</p>
		<?php endif; ?>

		<?php
		foreach ( $questions as $question ) :
			$q_key      = sanitize_key( $question['key'] ?? '' );
			$q_text     = $question['text'] ?? '';
			$q_type     = $question['type'] ?? 'short_text';
			$q_required = ! empty( $question['required'] );
			$q_options  = $question['options'] ?? array();
			$q_id       = esc_attr( $form_id . '-q-' . $q_key );

			$required_html = $q_required
				? ' <span class="required">*</span>'
				: '';
			$required_attr = $q_required ? ' required' : '';
			?>

			<?php if ( 'short_text' === $q_type ) : ?>
			<p>
				<label for="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>">
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</label>
				<input
					type="text"
					id="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>"
					name="questionnaire[<?php echo esc_attr( $q_key ); ?>]"
					<?php echo $required_attr; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				/>
			</p>

			<?php elseif ( 'long_text' === $q_type ) : ?>
			<div class="fair-audience-audience-question-group">
				<label for="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>">
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</label>
				<textarea
					id="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>"
					name="questionnaire[<?php echo esc_attr( $q_key ); ?>]"
					rows="3"
					<?php echo $required_attr; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				></textarea>
			</div>

			<?php elseif ( 'number' === $q_type ) : ?>
			<p>
				<label for="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>">
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</label>
				<input
					type="number"
					id="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>"
					name="questionnaire[<?php echo esc_attr( $q_key ); ?>]"
					<?php echo $required_attr; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				/>
			</p>

			<?php elseif ( 'date' === $q_type ) : ?>
			<p>
				<label for="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>">
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</label>
				<input
					type="date"
					id="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>"
					name="questionnaire[<?php echo esc_attr( $q_key ); ?>]"
					<?php echo $required_attr; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				/>
			</p>

			<?php elseif ( 'select' === $q_type ) : ?>
			<p>
				<label for="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>">
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</label>
				<select
					id="<?php echo $q_id; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>"
					name="questionnaire[<?php echo esc_attr( $q_key ); ?>]"
					<?php echo $required_attr; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				>
					<option value=""><?php echo esc_html__( 'Select...', 'fair-audience' ); ?></option>
					<?php foreach ( $q_options as $option ) : ?>
					<option value="<?php echo esc_attr( $option ); ?>"><?php echo esc_html( $option ); ?></option>
					<?php endforeach; ?>
				</select>
			</p>

			<?php elseif ( 'radio' === $q_type ) : ?>
			<fieldset class="fair-audience-audience-question-group">
				<legend>
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</legend>
				<?php foreach ( $q_options as $option ) : ?>
				<label class="fair-audience-option-label">
					<input
						type="radio"
						name="questionnaire[<?php echo esc_attr( $q_key ); ?>]"
						value="<?php echo esc_attr( $option ); ?>"
						<?php echo $required_attr; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
					/>
					<?php echo esc_html( $option ); ?>
				</label>
				<?php endforeach; ?>
			</fieldset>

			<?php elseif ( 'checkbox' === $q_type ) : ?>
			<fieldset class="fair-audience-audience-question-group">
				<legend>
					<?php echo esc_html( $q_text ); ?><?php echo $required_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</legend>
				<?php foreach ( $q_options as $option ) : ?>
				<label class="fair-audience-option-label">
					<input
						type="checkbox"
						name="questionnaire[<?php echo esc_attr( $q_key ); ?>][]"
						value="<?php echo esc_attr( $option ); ?>"
					/>
					<?php echo esc_html( $option ); ?>
				</label>
				<?php endforeach; ?>
			</fieldset>
			<?php endif; ?>

		<?php endforeach; ?>

		<?php if ( $show_keep_informed ) : ?>
		<div class="fair-audience-audience-checkbox">
			<label>
				<input type="checkbox" name="audience_keep_informed" value="1" />
				<?php echo esc_html__( 'Keep me informed about future events', 'fair-audience' ); ?>
			</label>
		</div>
		<?php endif; ?>

		<div class="wp-block-button">
			<button type="submit" class="wp-block-button__link wp-element-button fair-audience-audience-submit-button">
				<?php echo esc_html( $submit_text ); ?>
			</button>
		</div>

		<div class="fair-audience-audience-message" style="display: none;"></div>
	</form>
</div>
