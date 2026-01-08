<?php
/**
 * Event Proposal Form Block - Server-side rendering
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

// Get block attributes
$enable_categories  = $attributes['enableCategories'] ?? true;
$enable_description = $attributes['enableDescription'] ?? true;
$submit_button_text = $attributes['submitButtonText'] ?? __( 'Submit Event Proposal', 'fair-events' );

// Check if user is logged in
$is_logged_in = is_user_logged_in();

// Get categories if enabled
$categories = array();
if ( $enable_categories ) {
	$categories = get_categories(
		array(
			'taxonomy'   => 'category',
			'hide_empty' => false,
			'orderby'    => 'name',
			'order'      => 'ASC',
		)
	);
}

// Generate unique form ID
$form_id = 'fair-events-proposal-form-' . wp_unique_id();

// Duration options (in minutes)
$duration_options = array(
	30  => __( '30 minutes', 'fair-events' ),
	60  => __( '1 hour', 'fair-events' ),
	90  => __( '1.5 hours', 'fair-events' ),
	120 => __( '2 hours', 'fair-events' ),
	180 => __( '3 hours', 'fair-events' ),
	240 => __( '4 hours', 'fair-events' ),
);
?>

<div class="fair-events-proposal-form">
	<form
		id="<?php echo esc_attr( $form_id ); ?>"
		class="proposal-form"
		data-user-logged-in="<?php echo $is_logged_in ? 'true' : 'false'; ?>"
	>
		<?php if ( ! $is_logged_in ) : ?>
			<div class="form-row">
				<label for="<?php echo esc_attr( $form_id ); ?>-name" class="form-label required">
					<?php esc_html_e( 'Your Name', 'fair-events' ); ?>
					<span class="required-indicator">*</span>
				</label>
				<input
					type="text"
					id="<?php echo esc_attr( $form_id ); ?>-name"
					name="submitter_name"
					class="form-input"
					required
					maxlength="100"
				/>
			</div>

			<div class="form-row">
				<label for="<?php echo esc_attr( $form_id ); ?>-email" class="form-label required">
					<?php esc_html_e( 'Your Email', 'fair-events' ); ?>
					<span class="required-indicator">*</span>
				</label>
				<input
					type="email"
					id="<?php echo esc_attr( $form_id ); ?>-email"
					name="submitter_email"
					class="form-input"
					required
				/>
			</div>
		<?php endif; ?>

		<div class="form-row">
			<label for="<?php echo esc_attr( $form_id ); ?>-title" class="form-label required">
				<?php esc_html_e( 'Event Title', 'fair-events' ); ?>
				<span class="required-indicator">*</span>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-title"
				name="title"
				class="form-input"
				required
				minlength="3"
				maxlength="200"
			/>
		</div>

		<div class="form-row">
			<label for="<?php echo esc_attr( $form_id ); ?>-datetime" class="form-label required">
				<?php esc_html_e( 'Start Date & Time', 'fair-events' ); ?>
				<span class="required-indicator">*</span>
			</label>
			<input
				type="datetime-local"
				id="<?php echo esc_attr( $form_id ); ?>-datetime"
				name="start_datetime"
				class="form-input"
				required
				min="<?php echo esc_attr( gmdate( 'Y-m-d\TH:i' ) ); ?>"
			/>
		</div>

		<div class="form-row">
			<label for="<?php echo esc_attr( $form_id ); ?>-duration" class="form-label required">
				<?php esc_html_e( 'Event Length', 'fair-events' ); ?>
				<span class="required-indicator">*</span>
			</label>
			<select
				id="<?php echo esc_attr( $form_id ); ?>-duration"
				name="duration_minutes"
				class="form-input"
				required
			>
				<option value=""><?php esc_html_e( 'Select duration...', 'fair-events' ); ?></option>
				<?php foreach ( $duration_options as $minutes => $label ) : ?>
					<option value="<?php echo esc_attr( $minutes ); ?>">
						<?php echo esc_html( $label ); ?>
					</option>
				<?php endforeach; ?>
			</select>
		</div>

		<div class="form-row">
			<label for="<?php echo esc_attr( $form_id ); ?>-location" class="form-label required">
				<?php esc_html_e( 'Location', 'fair-events' ); ?>
				<span class="required-indicator">*</span>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-location"
				name="location"
				class="form-input"
				required
				maxlength="200"
			/>
		</div>

		<?php if ( $enable_categories && ! empty( $categories ) ) : ?>
			<div class="form-row">
				<fieldset class="form-fieldset">
					<legend class="form-label">
						<?php esc_html_e( 'Categories', 'fair-events' ); ?>
					</legend>
					<div class="form-checkbox-group">
						<?php foreach ( $categories as $category ) : ?>
							<label class="form-checkbox-label">
								<input
									type="checkbox"
									name="category_ids[]"
									value="<?php echo esc_attr( $category->term_id ); ?>"
									class="form-checkbox"
								/>
								<?php echo esc_html( $category->name ); ?>
							</label>
						<?php endforeach; ?>
					</div>
				</fieldset>
			</div>
		<?php endif; ?>

		<?php if ( $enable_description ) : ?>
			<div class="form-row">
				<label for="<?php echo esc_attr( $form_id ); ?>-description" class="form-label">
					<?php esc_html_e( 'Event Description', 'fair-events' ); ?>
				</label>
				<textarea
					id="<?php echo esc_attr( $form_id ); ?>-description"
					name="description"
					class="form-input form-textarea"
					rows="5"
					maxlength="5000"
				></textarea>
			</div>
		<?php endif; ?>

		<!-- Honeypot field (hidden from users, should remain empty) -->
		<input
			type="text"
			name="_honeypot"
			class="honeypot-field"
			tabindex="-1"
			autocomplete="off"
			aria-hidden="true"
		/>

		<div class="form-row form-submit">
			<button type="submit" class="form-button">
				<?php echo esc_html( $submit_button_text ); ?>
			</button>
		</div>

		<div class="message-container" role="alert" aria-live="polite"></div>
	</form>
</div>
