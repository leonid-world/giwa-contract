# MockKRW Owner 운영 가이드

이 문서는 이미 GIWA Sepolia에 배포된 MockKRW를 Hardhat으로 운영하는
방법을 설명한다. 컨트랙트를 다시 배포하지 않으며 데이터베이스도 변경하지
않는다.

## 1. 두 명령의 차이

| 목적 | 명령 | Owner 잔액 | 수취인 잔액 | 총발행량 |
| --- | --- | ---: | ---: | ---: |
| 기존 물량 지급 | `mkrw:transfer` | 감소 | 증가 | 유지 |
| 테스트 물량 추가발행 | `mkrw:mint` | 유지 | 증가 | 증가 |

MVP 운영 흐름을 보여줄 때는 배포 시 Owner에게 발행된 초기 물량을
`transfer`하는 방식을 우선 사용한다. 초기 물량이 부족하거나 추가발행 자체를
테스트해야 할 때만 `mint`를 사용한다.

MockKRW는 `decimals = 0`이므로 `8000000`은 정확히 `8,000,000 mKRW`다.
금액에는 쉼표, 소수점 또는 단위를 입력하지 않는다.

## 2. 실행 전 준비사항

- 터미널의 현재 디렉터리가 `giwa-contrract`인지 확인한다.
- `npm ci`가 완료되어 있어야 한다.
- `deployment/giwa-testnet.json`에 현재 배포 정보가 있어야 한다.
- MockKRW Owner 지갑에 트랜잭션 가스용 GIWA Sepolia ETH가 있어야 한다.
- 수취할 Funder 또는 Buyer의 실제 `0x` 지갑 주소를 준비한다.
- MetaMask에서 현재 MockKRW Owner 계정을 확인한다.

`DEPLOYER_PRIVATE_KEY`에는 지갑 주소가 아니라 **현재 MockKRW Owner 계정의
개인키**를 넣어야 한다. Funder, Buyer 또는 Seller 개인키를 넣는 것이 아니다.
현재 배포 기록의 Owner 후보는 `deployment/giwa-testnet.json`의 `deployer`
항목에서 확인할 수 있으며, 명령은 실행 전에 실제 온체인 `owner()`와 다시
비교한다.

## 3. MetaMask에서 Owner 개인키 확인

1. MetaMask에서 MockKRW를 배포한 Owner 계정을 선택한다.
2. 계정 메뉴에서 계정 세부정보를 연다.
3. `개인키 표시` 또는 `개인키 내보내기` 기능을 선택한다.
4. MetaMask 비밀번호로 확인한 뒤 개인키를 복사한다.

MetaMask 버전에 따라 메뉴 이름은 조금 다를 수 있다. 개인키는 이 채팅,
소스 코드, `.env`, 메모, 화면 캡처 또는 Git에 남기지 않는다.

## 4. Owner 개인키를 현재 터미널에만 입력

macOS 기본 zsh 터미널에서 다음 명령을 실행한다.

```bash
cd /Users/leonid/projects/blockchain/gasok/giwa-contrract

read -s "DEPLOYER_PRIVATE_KEY?GIWA MockKRW owner private key: "
```

프롬프트가 표시되면 복사한 Owner 개인키를 붙여넣고 Enter를 누른다. 입력
중에는 문자나 별표가 표시되지 않는 것이 정상이다. 개인키는 `0x` 접두사가
있거나 없어도 된다.

Hardhat이 읽을 수 있도록 현재 셸에 내보낸다.

```bash
export DEPLOYER_PRIVATE_KEY
```

개인키를 다음처럼 명령어에 직접 적으면 셸 기록에 남을 수 있으므로 금지한다.

```text
DEPLOYER_PRIVATE_KEY=실제개인키 npm run ...
```

## 5. 기존 Owner 잔액을 Funder 또는 Buyer에게 전송

아래의 `YOUR_RECIPIENT_WALLET`을 실제 수취 지갑 주소로 교체한다.

```bash
npm run mkrw:transfer -- YOUR_RECIPIENT_WALLET 8000000
```

이 명령은 다음 내용을 확인한 뒤 한 번의 `transfer` 트랜잭션을 보낸다.

- GIWA Sepolia Chain ID가 `91342`인지
- 배포 기록의 MockKRW 주소에 실제 컨트랙트 코드가 있는지
- 토큰 이름, 심볼 및 decimals가 현재 MVP MockKRW와 일치하는지
- 입력한 개인키의 지갑이 실제 온체인 Owner인지
- Owner에게 가스용 ETH와 전송할 mKRW가 충분한지
- 수취 주소와 금액이 유효한지

성공하면 Owner 잔액은 감소하고 수취인 잔액은 증가하지만 총발행량은 변하지
않는다.

## 6. 추가 테스트 mKRW 발행

추가발행이 명확하게 필요한 경우에만 실행한다.

```bash
npm run mkrw:mint -- YOUR_RECIPIENT_WALLET 8000000
```

`mint`는 Owner 잔액을 옮기는 것이 아니라 새로운 테스트 토큰을 생성한다.
수취인 잔액과 MockKRW 총발행량이 모두 입력 금액만큼 증가한다.

## 7. 실행 결과 확인

명령은 다음 정보를 출력한다.

- 네트워크와 MockKRW 주소
- Owner와 수취인 주소
- 처리 금액
- 처리 전후 잔액과 총발행량
- 트랜잭션 해시와 GIWA Explorer 링크
- 확정 블록과 사용 가스

`Transaction submitted`와 트랜잭션 해시가 출력된 이후 RPC 오류나 터미널
중단이 발생했다면 명령을 바로 다시 실행하지 않는다. 출력된 해시를 GIWA
Explorer에서 먼저 확인해야 중복 지급이나 중복 발행을 피할 수 있다.

GIWA 공개 RPC는 트랜잭션 영수증보다 확정 블록의 컨트랙트 상태 조회가 늦게
반영될 수 있다. 명령은 확정 블록의 잔액과 총발행량을 일정 시간 재조회한다.
그 이후에도 조회 결과가 늦으면 정확한 Transfer 이벤트를 기준으로 트랜잭션
성공을 알리고 상태 조회 경고를 표시한다. 이 경고는 재전송 사유가 아니며,
Explorer에서 기존 해시를 확인해야 한다.

## 8. MetaMask에서 Funder 또는 Buyer의 mKRW 잔액 확인

토큰 가져오기와 잔액 조회에는 개인키 입력이나 트랜잭션 서명이 필요하지 않다.
이 작업은 이미 해당 지갑 주소에 기록된 온체인 잔액을 MetaMask 화면에 표시할
뿐이며 토큰을 새로 전송하지 않는다.

### 8.1 GIWA Sepolia 커스텀 네트워크 추가

MetaMask에 GIWA Sepolia가 없다면 `네트워크 추가`에서 `네트워크 직접 추가`
또는 `Add a network manually`를 선택하고 다음 값을 입력한다.

```text
네트워크 이름
GIWA Sepolia

기본 RPC URL
https://sepolia-rpc.giwa.io

체인 ID
91342

통화 기호
ETH

블록 탐색기 URL
https://sepolia-explorer.giwa.io
```

Chain ID의 16진수 표기는 `0x164ce`지만 MetaMask 직접 입력 화면에는 일반적으로
십진수 `91342`를 사용한다. 네트워크 등록 정보는 MetaMask의 여러 계정에서
공유되지만, ETH와 mKRW 잔액은 각 계정 주소별로 별도 기록된다.

### 8.2 실제 수취 계정 선택

1. MetaMask 네트워크를 `GIWA Sepolia`로 선택한다.
2. Chain ID가 `91342`인지 확인한다.
3. 현재 활성 계정을 mKRW를 받은 Funder 또는 Buyer 계정으로 전환한다.
4. 계정 주소가 Hardhat 명령의 `Recipient` 출력과 같은지 확인한다.

### 8.3 현재 MockKRW 토큰 가져오기

1. MetaMask의 `토큰` 탭을 연다.
2. 우측 점 3개 또는 화면 하단에서 `토큰 가져오기`를 선택한다.
3. `맞춤 토큰` 또는 `Custom token` 입력 화면을 연다.

현재 배포의 토큰 정보는 다음과 같다.

```text
토큰 컨트랙트 주소
0x5cD8a99Dcf5Fa00fb4fD9873b41A15F9C13C9d3F

토큰 기호
mKRW

소수 자릿수
0
```

토큰 컨트랙트 주소는 지갑 주소가 아니다. `deployment/giwa-testnet.json`의
`mockKRW` 값과 같은 주소인지 확인한다. 컨트랙트를 다시 배포했다면 위의 고정
예시보다 최신 배포 파일의 주소가 우선한다.

주소를 입력하면 MetaMask가 기호와 소수 자릿수를 자동으로 채울 수 있다. 값이
자동으로 표시되지 않으면 각각 `mKRW`, `0`을 입력한 뒤 가져오기를 완료한다.

이전 Remix 또는 이전 Hardhat 배포의 mKRW가 이미 등록돼 있으면 같은 `mKRW`
기호가 여러 개 표시될 수 있다. 각 항목의 토큰 컨트랙트 주소를 확인하고 현재
배포 주소의 mKRW를 선택해야 한다. 서로 다른 배포의 잔액은 합쳐지지 않는다.

### 8.4 잔액 새로고침과 Explorer 확인

현재 배포 주소가 이미 등록돼 있지만 잔액이 갱신되지 않으면 다음 순서로
확인한다.

1. MetaMask를 닫았다가 다시 연다.
2. 다른 네트워크로 전환한 뒤 `GIWA Sepolia`로 돌아온다.
3. 활성 계정이 실제 수취 지갑인지 다시 확인한다.
4. Hardhat 출력의 Explorer 링크에서 성공 상태와 Token Transfer를 확인한다.

화면 갱신이 늦다는 이유로 동일한 `transfer` 또는 `mint` 명령을 다시 실행하면
안 된다. 현재 프로젝트에서 확인한 Funder 주소
`0x3dc823dc2C1caf3c14B5B882c7e9A80CC40DF9b7`은 첫 `10,000 mKRW`와 추가
`100,000 mKRW` 전송 후 온체인 잔액이 `110,000 mKRW`다.

## 9. 작업 후 개인키 제거

성공 여부와 관계없이 작업을 마치면 현재 터미널 변수에서 개인키를 제거한다.

```bash
unset DEPLOYER_PRIVATE_KEY
```

제거 여부는 값 자체를 출력하지 않고 다음처럼 확인한다.

```bash
if [[ -z "$DEPLOYER_PRIVATE_KEY" ]]; then echo "Owner key cleared"; fi
```

## 10. 자주 발생하는 오류

### `DEPLOYER_PRIVATE_KEY is missing`

`read -s` 실행 후 `export DEPLOYER_PRIVATE_KEY`를 실행했는지 확인한다. 개인키를
화면에 출력해서 확인하지 않는다.

### `Configured signer ... is not the onchain MockKRW owner`

MetaMask에서 다른 계정의 개인키를 가져온 상태다. 현재 MockKRW Owner 계정을
다시 확인한다. Funder 개인키로는 Owner 전송 명령이나 mint를 실행할 수 없다.

### `Owner ... has no GIWA Sepolia ETH for gas`

Owner 지갑에 테스트넷 가스용 ETH가 필요하다. mKRW 잔액과 가스용 ETH는 서로
다른 자산이다.

### `Owner balance is ... below the requested ...`

기존 Owner mKRW 잔액보다 큰 금액을 `transfer`하려는 경우다. 전송 금액을
줄이거나, 추가 테스트 공급이 정말 필요할 때만 `mkrw:mint`를 사용한다.

### `No contract code was found`

GIWA RPC, Chain ID 또는 `deployment/giwa-testnet.json`의 배포 주소가 서로
맞지 않는 상태다. 새로운 컨트랙트를 배포하지 말고 먼저 현재 네트워크와 배포
기록을 확인한다.

### 확정됐지만 RPC 상태가 아직 일치하지 않는다는 경고

트랜잭션 영수증과 정확한 Transfer 이벤트는 확인됐지만 공개 RPC의 잔액 조회가
아직 확정 블록을 반영하지 못한 경우다. 트랜잭션은 성공한 것이므로 같은 명령을
다시 실행하지 않는다. 출력된 Explorer 링크에서 기존 해시와 토큰 전송 내역을
확인한다.

### 주소 또는 금액 오류

수취 주소는 42자리 `0x` EVM 주소여야 한다. 금액은 `1` 이상의 정수이며 쉼표와
소수점을 사용할 수 없다.

## 11. 보안 원칙

- Owner 개인키나 시드 문구를 누구에게도 전달하지 않는다.
- 개인키를 Git, `.env`, 애플리케이션 설정 또는 백엔드에 저장하지 않는다.
- Seller, Buyer, Funder의 채권 생명주기 트랜잭션은 계속 MetaMask로 서명한다.
- 이 Hardhat 명령은 테스트 전용 MockKRW Owner 운영에만 사용한다.
- MockKRW는 실물 가치가 없는 MVP 테스트 토큰이다.
