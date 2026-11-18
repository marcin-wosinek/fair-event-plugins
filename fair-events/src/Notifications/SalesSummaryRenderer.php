<?php
/**
 * Sales summary email content.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Helpers\DateHelper;
use FairEvents\Services\EventsWeekSummary;
use FairEvents\Services\PurchasePaymentHistory;
use FairEventsShared\Helpers\DisplayText;
use FairEventsShared\Money;
use FairEventsShared\Notifications\EmailLayout;

defined( 'WPINC' ) || die;

/**
 * Renders a sales summary report as an email subject and HTML content
 * (#2306). The sender wraps the content in its email layout.
 *
 * Revenue that can't be read is shown as not available, never as 0. The
 * email ends with what the figures count, so a recipient can read them
 * without the Statistics tab.
 */
class SalesSummaryRenderer {
	private const CELL        = 'padding: 6px 8px; border-bottom: 1px solid #dddddd; vertical-align: top;';
	private const CELL_NUMBER = 'padding: 6px 8px; border-bottom: 1px solid #dddddd; vertical-align: top; text-align: right; white-space: nowrap;';
	private const HEAD        = 'padding: 6px 8px; border-bottom: 2px solid #cccccc; text-align: left; font-size: 13px;';
	private const HEAD_NUMBER = 'padding: 6px 8px; border-bottom: 2px solid #cccccc; text-align: right; font-size: 13px;';

	/**
	 * Render a report.
	 *
	 * @param array $report Report from {@see SalesSummaryReport::build()}.
	 * @param bool  $test   Whether this is a test email.
	 * @return array{subject: string, html: string, empty: bool}
	 */
	public static function compose( array $report, $test = false ) {
		$period = self::period_label( $report['frequency'], $report['period'] );

		$subject = $report['central']
			/* translators: %s: reporting period, e.g. "9–15 Nov 2026" */
			? sprintf( __( 'Sales summary for all organizers: %s', 'fair-events' ), $period )
			/* translators: 1: organizer name, 2: reporting period, e.g. "9–15 Nov 2026" */
			: sprintf( __( 'Sales summary for %1$s: %2$s', 'fair-events' ), DisplayText::decode( (string) $report['organizer']['name'] ), $period );
		if ( $test ) {
			/* translators: %s: email subject */
			$subject = sprintf( __( '[Test] %s', 'fair-events' ), $subject );
		}

		return array(
			'subject' => sanitize_text_field( $subject ),
			'html'    => self::body( $report, $period, $test ),
			'empty'   => $report['empty'],
		);
	}

	/**
	 * A period as recipients read it: one day, or a week's range.
	 *
	 * @param string $frequency Daily or weekly.
	 * @param array  $period    Period boundaries.
	 * @return string
	 */
	public static function period_label( $frequency, array $period ) {
		if ( SalesSummarySettings::WEEKLY === $frequency ) {
			return EventsWeekSummary::range_title( $period['start'], $period['end'] );
		}

		return wp_date( (string) get_option( 'date_format', 'Y-m-d' ), DateHelper::local_to_datetime( $period['start'] . ' 00:00:00' )->getTimestamp() );
	}

	/**
	 * The email content.
	 *
	 * @param array  $report Report.
	 * @param string $period Period label.
	 * @param bool   $test   Whether this is a test email.
	 * @return string HTML.
	 */
	private static function body( array $report, $period, $test ) {
		$html = '';
		if ( $test ) {
			$html .= EmailLayout::paragraph(
				'<strong>' . esc_html__( 'This is a test email. It was sent only to you and does not count as a scheduled summary.', 'fair-events' ) . '</strong>',
				EmailLayout::NOTE
			);
		}

		$html .= EmailLayout::paragraph(
			esc_html(
				SalesSummarySettings::WEEKLY === $report['frequency']
					/* translators: %s: reporting week, e.g. "9–15 Nov 2026" */
					? sprintf( __( 'Ticket sales and paid revenue for the week of %s.', 'fair-events' ), $period )
					/* translators: %s: reporting day, e.g. "November 17, 2026" */
					: sprintf( __( 'Ticket sales and paid revenue for %s.', 'fair-events' ), $period )
			)
		);

		$excluded   = array();
		$incomplete = false;
		$missing    = false;
		$currency   = Money::site_currency();
		foreach ( $report['groups'] as $group ) {
			if ( $report['central'] ) {
				$html .= EmailLayout::heading( DisplayText::html( DisplayText::decode( (string) $group['organizer']['name'] ) ) );
			}
			if ( ! $group['events'] ) {
				$html .= EmailLayout::paragraph( esc_html__( 'No sales in this period.', 'fair-events' ) );
				continue;
			}

			$html .= self::table( $group['events'] );
			foreach ( $group['events'] as $event ) {
				foreach ( array( $event['period_revenue'], $event['total_revenue'] ) as $revenue ) {
					$currency = $revenue['currency'];
					$excluded = array_merge( $excluded, $revenue['excluded_currencies'] );
					if ( PurchasePaymentHistory::STATE_INCOMPLETE === $revenue['state'] ) {
						$incomplete = true;
					} elseif ( PurchasePaymentHistory::STATE_UNAVAILABLE === $revenue['state'] ) {
						$missing = true;
					}
				}
			}
		}

		return $html . self::notes( $currency, array_values( array_unique( $excluded ) ), $incomplete, $missing );
	}

	/**
	 * One organizer's events as a table.
	 *
	 * @param array[] $events Events.
	 * @return string HTML.
	 */
	private static function table( array $events ) {
		$html  = '<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; margin: 0 0 20px 0; font-size: 14px;">';
		$html .= '<tr>'
			. '<th style="' . self::HEAD . '">' . esc_html__( 'Event', 'fair-events' ) . '</th>'
			. '<th style="' . self::HEAD_NUMBER . '">' . esc_html__( 'Tickets sold', 'fair-events' ) . '</th>'
			. '<th style="' . self::HEAD_NUMBER . '">' . esc_html__( 'Paid revenue', 'fair-events' ) . '</th>'
			. '<th style="' . self::HEAD_NUMBER . '">' . esc_html__( 'Tickets to date', 'fair-events' ) . '</th>'
			. '<th style="' . self::HEAD_NUMBER . '">' . esc_html__( 'Revenue to date', 'fair-events' ) . '</th>'
			. '</tr>';

		foreach ( $events as $event ) {
			$name = DisplayText::html( (string) $event['title'] );
			if ( $event['is_series'] ) {
				$name .= ' <span style="color: #666666;">' . esc_html__( '(series)', 'fair-events' ) . '</span>';
			}
			$html .= '<tr>'
				. '<td style="' . self::CELL . ' overflow-wrap: anywhere;">' . $name . '</td>'
				. '<td style="' . self::CELL_NUMBER . '">' . esc_html( number_format_i18n( (int) $event['period_tickets'] ) ) . '</td>'
				. '<td style="' . self::CELL_NUMBER . '">' . esc_html( self::revenue( $event['period_revenue'] ) ) . '</td>'
				. '<td style="' . self::CELL_NUMBER . '">' . esc_html( number_format_i18n( (int) $event['total_tickets'] ) ) . '</td>'
				. '<td style="' . self::CELL_NUMBER . '">' . esc_html( self::revenue( $event['total_revenue'] ) ) . '</td>'
				. '</tr>';
		}

		return $html . '</table>';
	}

	/**
	 * A revenue figure: the amount, marked when incomplete; never 0 when
	 * it can't be read.
	 *
	 * @param array $revenue Revenue summary.
	 * @return string Plain text.
	 */
	public static function revenue( array $revenue ) {
		if ( PurchasePaymentHistory::STATE_UNAVAILABLE === $revenue['state'] || null === $revenue['total'] ) {
			return __( 'Not available', 'fair-events' );
		}

		$amount = Money::format_display( (float) $revenue['total'], $revenue['currency'] );
		return PurchasePaymentHistory::STATE_INCOMPLETE === $revenue['state']
			/* translators: %s: amount with currency, e.g. "120.00 EUR" */
			? sprintf( __( '%s (incomplete)', 'fair-events' ), $amount )
			: $amount;
	}

	/**
	 * What the figures count.
	 *
	 * @param string   $currency   Site currency.
	 * @param string[] $excluded   Currencies left out.
	 * @param bool     $incomplete Whether a figure is incomplete.
	 * @param bool     $missing    Whether revenue couldn't be read.
	 * @return string HTML.
	 */
	private static function notes( $currency, array $excluded, $incomplete, $missing ) {
		$notes = array(
			__( 'Tickets sold counts the confirmed tickets bought in this period. Cancelled and refunded tickets are not counted.', 'fair-events' ),
			/* translators: %s: currency code, e.g. "EUR" */
			sprintf( __( 'Paid revenue is the paid amount assigned to each event’s purchases in %s. Refunded payments are not counted.', 'fair-events' ), $currency ),
			__( 'A whole-series purchase is counted once, under its series.', 'fair-events' ),
			__( 'Totals to date count every sale so far, as of when this summary was generated.', 'fair-events' ),
		);
		if ( $excluded ) {
			/* translators: %s: comma-separated currency codes, e.g. "USD, GBP" */
			$notes[] = sprintf( __( 'Payments in other currencies are not converted or included: %s.', 'fair-events' ), implode( ', ', $excluded ) );
		}
		if ( $incomplete ) {
			$notes[] = __( 'Incomplete: some paid money for the event is not assigned to its purchases yet. The amount shown is what is assigned so far.', 'fair-events' );
		}
		if ( $missing ) {
			$notes[] = __( 'Revenue isn’t available because payment information can’t be read.', 'fair-events' );
		}

		$html = '';
		foreach ( $notes as $note ) {
			$html .= EmailLayout::paragraph( esc_html( $note ), EmailLayout::NOTE );
		}
		return $html;
	}
}
