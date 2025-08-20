<?php
/**
 * Transaction list page for Fair Payment admin
 *
 * @package FairPayment
 */

namespace FairPayment\Admin\Pages;

defined( 'WPINC' ) || die;

/**
 * Transaction list page class
 */
class TransactionListPage {

	/**
	 * Render the transaction list page
	 *
	 * @return void
	 */
	public function render() {
		?>
		<div class="wrap">
			<h1><?php echo esc_html__( 'Fair Payment Transactions', 'fair-payment' ); ?></h1>
			
			<div class="card">
				<h2><?php echo esc_html__( 'Recent Transactions', 'fair-payment' ); ?></h2>
				
				<div class="tablenav top">
					<div class="alignleft actions">
						<select name="bulk-action" id="bulk-action-selector-top">
							<option value="-1"><?php echo esc_html__( 'Bulk Actions', 'fair-payment' ); ?></option>
							<option value="delete"><?php echo esc_html__( 'Delete', 'fair-payment' ); ?></option>
							<option value="refund"><?php echo esc_html__( 'Refund', 'fair-payment' ); ?></option>
						</select>
						<input type="submit" class="button action" value="<?php echo esc_attr__( 'Apply', 'fair-payment' ); ?>" />
					</div>
					
					<div class="tablenav-pages">
						<span class="displaying-num">
							<?php printf( esc_html__( '%d items', 'fair-payment' ), 0 ); ?>
						</span>
					</div>
				</div>
				
				<table class="wp-list-table widefat fixed striped">
					<thead>
						<tr>
							<td class="manage-column column-cb check-column">
								<input type="checkbox" />
							</td>
							<th scope="col" class="manage-column column-id">
								<?php echo esc_html__( 'ID', 'fair-payment' ); ?>
							</th>
							<th scope="col" class="manage-column column-amount">
								<?php echo esc_html__( 'Amount', 'fair-payment' ); ?>
							</th>
							<th scope="col" class="manage-column column-status">
								<?php echo esc_html__( 'Status', 'fair-payment' ); ?>
							</th>
							<th scope="col" class="manage-column column-date">
								<?php echo esc_html__( 'Date', 'fair-payment' ); ?>
							</th>
							<th scope="col" class="manage-column column-actions">
								<?php echo esc_html__( 'Actions', 'fair-payment' ); ?>
							</th>
						</tr>
					</thead>
					
					<tbody id="the-list">
						<?php $this->render_sample_transactions(); ?>
					</tbody>
					
					<tfoot>
						<tr>
							<td class="manage-column column-cb check-column">
								<input type="checkbox" />
							</td>
							<th scope="col" class="manage-column column-id">
								<?php echo esc_html__( 'ID', 'fair-payment' ); ?>
							</th>
							<th scope="col" class="manage-column column-amount">
								<?php echo esc_html__( 'Amount', 'fair-payment' ); ?>
							</th>
							<th scope="col" class="manage-column column-status">
								<?php echo esc_html__( 'Status', 'fair-payment' ); ?>
							</th>
							<th scope="col" class="manage-column column-date">
								<?php echo esc_html__( 'Date', 'fair-payment' ); ?>
							</th>
							<th scope="col" class="manage-column column-actions">
								<?php echo esc_html__( 'Actions', 'fair-payment' ); ?>
							</th>
						</tr>
					</tfoot>
				</table>
				
				<div class="tablenav bottom">
					<div class="tablenav-pages">
						<span class="displaying-num">
							<?php printf( esc_html__( '%d items', 'fair-payment' ), 0 ); ?>
						</span>
					</div>
				</div>
			</div>
		</div>
		<?php
	}
	
	/**
	 * Render sample transactions for demonstration
	 *
	 * @return void
	 */
	private function render_sample_transactions() {
		$sample_transactions = array(
			array(
				'id' => '12345',
				'amount' => '€50.00',
				'status' => 'completed',
				'date' => '2024-08-20 10:30:00'
			),
			array(
				'id' => '12346',
				'amount' => '$25.00',
				'status' => 'pending',
				'date' => '2024-08-20 09:15:00'
			),
			array(
				'id' => '12347',
				'amount' => '£75.00',
				'status' => 'failed',
				'date' => '2024-08-19 16:45:00'
			)
		);
		
		if ( empty( $sample_transactions ) ) {
			?>
			<tr class="no-items">
				<td class="colspanchange" colspan="6">
					<?php echo esc_html__( 'No transactions found.', 'fair-payment' ); ?>
				</td>
			</tr>
			<?php
			return;
		}
		
		foreach ( $sample_transactions as $transaction ) {
			$status_class = 'status-' . $transaction['status'];
			?>
			<tr>
				<th scope="row" class="check-column">
					<input type="checkbox" name="transaction[]" value="<?php echo esc_attr( $transaction['id'] ); ?>" />
				</th>
				<td class="column-id">
					<strong>#<?php echo esc_html( $transaction['id'] ); ?></strong>
				</td>
				<td class="column-amount">
					<?php echo esc_html( $transaction['amount'] ); ?>
				</td>
				<td class="column-status">
					<span class="status-badge <?php echo esc_attr( $status_class ); ?>">
						<?php echo esc_html( ucfirst( $transaction['status'] ) ); ?>
					</span>
				</td>
				<td class="column-date">
					<?php echo esc_html( date_i18n( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $transaction['date'] ) ) ); ?>
				</td>
				<td class="column-actions">
					<a href="#" class="button button-small">
						<?php echo esc_html__( 'View', 'fair-payment' ); ?>
					</a>
					<a href="#" class="button button-small">
						<?php echo esc_html__( 'Refund', 'fair-payment' ); ?>
					</a>
				</td>
			</tr>
			<?php
		}
	}
}