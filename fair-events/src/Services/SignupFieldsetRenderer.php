<?php
/**
 * Signup ticket-type / ticket-options fieldset renderer.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

/**
 * Renders the Event Signup form's two ticket-selection fieldsets as
 * self-contained HTML fragments, shared between the block's base render
 * (render.php, cache-safe baseline) and the viewer-context REST endpoint
 * (GetTicketsController::get_viewer_context(), personalized fragments) so
 * both produce identical markup for a given ticket-type/options set instead
 * of maintaining the templating logic twice.
 */
class SignupFieldsetRenderer {

	/**
	 * Resolve the first ticket type not blocked by a payments-unavailable
	 * price, matching the radio pre-selection shown on first paint.
	 *
	 * @param object[] $ticket_types         Ticket type objects.
	 * @param float[]  $price_by_type_id     Ticket-type ID => resolved price.
	 * @param bool     $payments_unavailable Whether online payments can't be collected right now.
	 * @return int|null
	 */
	public static function resolve_first_enabled_type_id( array $ticket_types, array $price_by_type_id, $payments_unavailable ) {
		foreach ( $ticket_types as $ticket_type ) {
			$type_id    = (int) $ticket_type->id;
			$type_price = $price_by_type_id[ $type_id ] ?? null;
			if ( ! ( $payments_unavailable && null !== $type_price && $type_price > 0 ) ) {
				return $type_id;
			}
		}
		return null;
	}

	/**
	 * Resolve an activity option's display name/short_name, translated
	 * through Polylang when fair-events-experimental's translation bridge
	 * is available — shared so render.php and get_viewer_context() don't
	 * each carry their own copy of the class_exists() guard.
	 *
	 * @param object $opt TicketOption-like object (needs name, short_name).
	 * @return array{name: string, short_name: string|null}
	 */
	public static function resolve_option_display( $opt ) {
		if ( ! class_exists( \FairEventsExperimental\Services\ActivityOptionTranslation::class ) ) {
			return array(
				'name'       => $opt->name,
				'short_name' => $opt->short_name ?? null,
			);
		}

		return array(
			'name'       => \FairEventsExperimental\Services\ActivityOptionTranslation::translate_name( $opt ),
			'short_name' => \FairEventsExperimental\Services\ActivityOptionTranslation::translate_short_name( $opt ),
		);
	}

	/**
	 * Render the "Choose ticket type" fieldset.
	 *
	 * @param object[]    $ticket_types         Ticket type objects for this event date.
	 * @param float[]     $price_by_type_id     Ticket-type ID => resolved price.
	 * @param object|null $active_sale_period   Active sale period row, or null.
	 * @param int         $sale_period_count    Number of configured sale periods.
	 * @param bool        $show_ticket_price    Whether to show the price in each option's label.
	 * @param bool        $payments_unavailable Whether online payments can't be collected right now.
	 * @param string      $form_id              Unique prefix for input/label IDs.
	 * @return string HTML, or '' when there are no ticket types.
	 */
	public static function ticket_type_fieldset( array $ticket_types, array $price_by_type_id, $active_sale_period, $sale_period_count, $show_ticket_price, $payments_unavailable, $form_id ) {
		if ( empty( $ticket_types ) ) {
			return '';
		}

		$first_enabled_type_id = self::resolve_first_enabled_type_id( $ticket_types, $price_by_type_id, $payments_unavailable );

		ob_start();
		?>
		<div class="form-row">
			<fieldset class="fair-events-ticket-fieldset">
				<legend class="form-label"><?php esc_html_e( 'Choose ticket type', 'fair-events' ); ?></legend>
				<?php if ( $active_sale_period && $sale_period_count > 1 ) : ?>
					<p class="fair-events-sale-period-context">
						<?php
						printf(
							/* translators: %s: active ticket sale period name. */
							esc_html__( 'You’re seeing %s prices.', 'fair-events' ),
							esc_html( $active_sale_period->name )
						);
						?>
					</p>
				<?php endif; ?>
				<?php foreach ( $ticket_types as $ticket_type ) : ?>
					<?php
					$type_id          = (int) $ticket_type->id;
					$type_price       = $price_by_type_id[ $type_id ] ?? null;
					$type_unavailable = $payments_unavailable && null !== $type_price && $type_price > 0;
					$label            = esc_html( $ticket_type->name );
					if ( $show_ticket_price && null !== $type_price ) {
						$label .= ' — ' . esc_html( \FairEventsShared\Money::format_inline( $type_price ) );
					}
					if ( $type_unavailable ) {
						$label .= ' — ' . esc_html__( 'ticket sales temporarily unavailable', 'fair-events' );
					}
					$radio_id = $form_id . '-ticket-type-' . $type_id;
					?>
					<label class="fair-events-ticket-option" for="<?php echo esc_attr( $radio_id ); ?>">
						<input
							type="radio"
							id="<?php echo esc_attr( $radio_id ); ?>"
							name="ticket_type_id"
							value="<?php echo esc_attr( $type_id ); ?>"
							data-ticket-price="<?php echo esc_attr( null !== $type_price ? \FairEventsShared\Money::format_value( $type_price ) : '' ); ?>"
							data-recurrence-scope="<?php echo esc_attr( $ticket_type->recurrence_scope ); ?>"
							data-min-instances="<?php echo esc_attr( (string) $ticket_type->minimum_instances ); ?>"
							data-min-activities="<?php echo esc_attr( (string) $ticket_type->minimum_activities ); ?>"
							<?php echo $type_unavailable ? 'disabled' : ''; ?>
							<?php echo $type_id === $first_enabled_type_id ? 'checked' : ''; ?>
						/>
						<?php echo esc_html( $label ); ?>
					</label>
				<?php endforeach; ?>
			</fieldset>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Render the "Select activities" fieldset.
	 *
	 * @param array    $ticket_options       Activity option rows ([ id, name, short_name, price, is_full ]).
	 * @param object[] $ticket_types         Ticket type objects, used to resolve the preselected type's own minimum-activities.
	 * @param float[]  $price_by_type_id     Ticket-type ID => resolved price.
	 * @param int      $minimum_activities   Event-date global minimum-activities requirement.
	 * @param bool     $show_option_prices   Whether to show each option's add-on price tag.
	 * @param bool     $payments_unavailable Whether online payments can't be collected right now.
	 * @param string   $form_id              Unique prefix for input/label IDs.
	 * @return string HTML, or '' when there are no activity options.
	 */
	public static function ticket_options_fieldset( array $ticket_options, array $ticket_types, array $price_by_type_id, $minimum_activities, $show_option_prices, $payments_unavailable, $form_id ) {
		if ( empty( $ticket_options ) ) {
			return '';
		}

		$first_enabled_type_id = self::resolve_first_enabled_type_id( $ticket_types, $price_by_type_id, $payments_unavailable );

		$any_ticket_type_min = 0;
		foreach ( $ticket_types as $tt_for_min ) {
			$any_ticket_type_min = max( $any_ticket_type_min, (int) $tt_for_min->minimum_activities );
		}

		$preselected_type_min = 0;
		if ( ! empty( $first_enabled_type_id ) ) {
			foreach ( $ticket_types as $tt_preselected ) {
				if ( (int) $tt_preselected->id === $first_enabled_type_id ) {
					$preselected_type_min = (int) $tt_preselected->minimum_activities;
					break;
				}
			}
		}

		$options_feature_active = ( $minimum_activities > 0 || $any_ticket_type_min > 0 );
		$initial_min_activities = min( count( $ticket_options ), max( $minimum_activities, $preselected_type_min ) );

		ob_start();
		?>
		<div class="form-row">
			<fieldset class="fair-events-ticket-options">
				<legend class="form-label"><?php esc_html_e( 'Select activities', 'fair-events' ); ?></legend>
				<?php if ( $options_feature_active ) : ?>
					<?php
					$hint_text = $initial_min_activities > 0
						? sprintf(
							/* translators: %d: minimum number of activities required */
							_n(
								'Please select at least %d activity to sign up.',
								'Please select at least %d activities to sign up.',
								$initial_min_activities,
								'fair-events'
							),
							$initial_min_activities
						)
						: '';
					$hint_style = $initial_min_activities > 0 ? '' : ' style="display: none;"';
					?>
					<p class="fair-events-ticket-options-min-hint"<?php echo $hint_style; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static literal. ?>>
						<?php echo esc_html( $hint_text ); ?>
					</p>
				<?php endif; ?>
				<?php foreach ( $ticket_options as $opt ) : ?>
					<?php
					$opt_label   = $opt['name'];
					$opt_is_full = ! empty( $opt['is_full'] );
					if ( $opt_is_full ) {
						$opt_label .= ' — ' . __( 'full', 'fair-events' );
					}
					$opt_checkbox_id = $form_id . '-opt-' . (int) $opt['id'];
					$opt_classes     = 'fair-events-ticket-option-item';
					if ( $opt_is_full ) {
						$opt_classes .= ' fair-events-ticket-option-full';
					}
					?>
					<label class="<?php echo esc_attr( $opt_classes ); ?>" for="<?php echo esc_attr( $opt_checkbox_id ); ?>">
						<input
							type="checkbox"
							name="ticket_option_ids[]"
							id="<?php echo esc_attr( $opt_checkbox_id ); ?>"
							value="<?php echo (int) $opt['id']; ?>"
							class="form-checkbox"
							data-option-price="<?php echo esc_attr( \FairEventsShared\Money::format_value( $opt['price'] ) ); ?>"
							data-option-short-name="<?php echo esc_attr( $opt['short_name'] ?? '' ); ?>"
							<?php echo $opt_is_full ? 'disabled' : ''; ?>
						/>
						<span class="fair-events-ticket-option-text">
							<?php echo esc_html( $opt_label ); ?>
							<?php if ( $show_option_prices && 0.0 !== (float) $opt['price'] ) : ?>
								<span class="fair-events-ticket-option-addon" style="display: none;">
									<?php if ( $opt['price'] > 0 ) : ?>
										<?php
										printf(
											/* translators: %s: formatted add-on price */
											esc_html__( '+%s', 'fair-events' ),
											esc_html( \FairEventsShared\Money::format_inline( $opt['price'] ) )
										);
										?>
									<?php else : ?>
										<?php
										printf(
											/* translators: %s: formatted add-on price */
											esc_html__( '-%s', 'fair-events' ),
											esc_html( \FairEventsShared\Money::format_inline( abs( $opt['price'] ) ) )
										);
										?>
									<?php endif; ?>
								</span>
							<?php endif; ?>
						</span>
					</label>
				<?php endforeach; ?>
				<p class="fair-events-ticket-options-total"></p>
			</fieldset>
		</div>
		<?php
		return ob_get_clean();
	}
}
