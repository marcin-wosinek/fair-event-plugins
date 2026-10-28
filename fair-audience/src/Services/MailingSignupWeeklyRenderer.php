<?php
/**
 * Mailing Signup Weekly Renderer
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Renders the weekly-update controls of the Mailing Signup block.
 *
 * Feeds are listed when the page renders and checked again on submission.
 * When the form's feeds cannot be offered, the form says so and submits
 * the weekly update as declined, so a signup never falls back to every
 * weekly email.
 */
class MailingSignupWeeklyRenderer {

	/**
	 * Render the weekly-update controls.
	 *
	 * @param string           $form_id    Unique ID of the form instance.
	 * @param array            $attributes Block attributes.
	 * @param WeeklyFeeds|null $feeds      Weekly feeds; Fair Events' when null.
	 */
	public static function render( string $form_id, array $attributes, $feeds = null ) {
		$policy = MailingSignupWeeklyPolicy::from_attributes( $attributes );
		if ( ! $policy ) {
			return;
		}

		$offered = self::offered_feeds( $policy, $feeds ?? new WeeklyFeeds() );
		$checked = MailingSignupWeeklyPolicy::WEEKLY_CHECKED === $policy['weekly'];
		?>
		<fieldset
			class="fair-audience-mailing-weekly"
			data-weekly-config="<?php echo esc_attr( MailingSignupWeeklyPolicy::sign( $policy ) ); ?>"
			data-weekly-feeds="<?php echo esc_attr( $policy['feeds'] ); ?>"
		>
			<legend><?php echo esc_html__( 'Weekly update', 'fair-audience' ); ?></legend>
			<?php if ( ! $offered ) : ?>
				<p class="fair-audience-mailing-weekly-unavailable">
					<?php echo esc_html__( 'Weekly updates are not available right now.', 'fair-audience' ); ?>
				</p>
			<?php else : ?>
				<label class="fair-audience-mailing-category-label">
					<input
						type="checkbox"
						name="mailing_weekly"
						value="1"
						<?php checked( $checked ); ?>
					/>
					<?php echo esc_html__( 'Receive a weekly update of upcoming events', 'fair-audience' ); ?>
				</label>
				<?php if ( MailingSignupWeeklyPolicy::FEEDS_MULTISELECT === $policy['feeds'] ) : ?>
					<fieldset
						class="fair-audience-mailing-feeds"
						aria-describedby="<?php echo esc_attr( $form_id ); ?>-feeds-help"
					>
						<legend><?php echo esc_html__( 'Event feeds', 'fair-audience' ); ?></legend>
						<?php foreach ( $offered as $feed ) : ?>
							<label class="fair-audience-mailing-category-label">
								<input
									type="checkbox"
									name="mailing_weekly_feeds[]"
									value="<?php echo esc_attr( (string) $feed['id'] ); ?>"
								/>
								<?php echo esc_html( $feed['name'] ); ?>
							</label>
						<?php endforeach; ?>
						<p id="<?php echo esc_attr( $form_id ); ?>-feeds-help" class="fair-audience-mailing-hint">
							<?php echo esc_html__( 'Choose at least one event feed to receive its weekly update.', 'fair-audience' ); ?>
						</p>
					</fieldset>
				<?php endif; ?>
			<?php endif; ?>
		</fieldset>
		<?php
	}

	/**
	 * Feeds the form can offer now.
	 *
	 * @param array       $policy Policy from {@see MailingSignupWeeklyPolicy::from_attributes()}.
	 * @param WeeklyFeeds $feeds  Weekly feeds.
	 * @return array[] Each with `id` and `name`; for a hidden feed, only the configured one.
	 */
	private static function offered_feeds( array $policy, $feeds ): array {
		$subscribable = $feeds->subscribable();
		if ( MailingSignupWeeklyPolicy::FEEDS_MULTISELECT === $policy['feeds'] ) {
			return $subscribable;
		}

		return array_values(
			array_filter(
				$subscribable,
				function ( $feed ) use ( $policy ) {
					return (int) $feed['id'] === $policy['feed_id'];
				}
			)
		);
	}
}
